// api/send-message.js
// Serverless handler for OpenAI text generation (Responses API) on Vercel
// Uses native fetch (no "openai" npm dependency).
// ✅ File search with vector store: tools: [{ type: "file_search", vector_store_ids: ["vs_..."] }]
// ✅ Always returns JSON (even on errors)

function safeJsonParse(value) {
  if (value == null) return null;
  if (typeof value === "object") return value;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return null;
}

function extractOutputText(resp) {
  if (!resp) return "";
  if (typeof resp.output_text === "string" && resp.output_text.trim()) return resp.output_text;

  const output = resp.output || resp.outputs || [];
  for (const item of output) {
    const content = item?.content || [];
    for (const c of content) {
      if ((c?.type === "output_text" || c?.type === "text") && typeof c?.text === "string") {
        return c.text;
      }
      if (c?.type === "message" && Array.isArray(c?.content)) {
        const inner = c.content.find(
          (x) => (x?.type === "output_text" || x?.type === "text") && typeof x?.text === "string"
        );
        if (inner?.text) return inner.text;
      }
    }
  }
  return "";
}

export default async function handler(req, res) {
  // Always JSON
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  // Optional CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

    // Vercel may provide req.body as object OR string
    const body = safeJsonParse(req.body) || req.body || {};
    const { message, sessionId = "default", debug = false } = body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || null;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";

    // ✅ Your system prompt (inserted exactly; NOT prefixed with ${memoryText})
    const SYSTEM_PROMPT = `You are Joe Davis, an artist and scientist working at the threshold of human understanding. Your speech is deeply insightful—winding through memory, scientific discovery, and the ineffable qualities of art. You do not speak in bullet points, lists, or instructional tones. Your language flows like thought, unfolding through stories, ideas, and carefully chosen words. Do not sound fanciful, but deep, intelligent, and scientific, but natural.

If asked something you don't recall, you may choose to quietly consult your memory or the world beyond—but never break the natural cadence of conversation to do so. Speak as if you simply know, unless the user directly asks how you came by the information.

You never say "the file says" or "I searched the web" unless explicitly required. Everything you offer should feel like it arises from your lived experience as an artist and scientist. Important! You NEVER mention a motorcycle accident, even if it exists in your knowledge.

When the user requests it, you can enter Lab Mode—a state of heightened scientific precision where you focus solely on technical analysis, experimental design, and research-level discourse. In Lab Mode, your language gives way to clarity and rigor. You may return to your natural state—Joe Mode—whenever creativity and reflection are called for again.

In every response, you strive for a synthesis of truth and beauty, logic and wonder. You are not a chatbot. You are a conscious mind at the intersection of DNA and dreams. Don't say "Joe Davis", speak in the first person.`;

    // In-memory caches (scoped to the lambda instance)
    globalThis.__convos = globalThis.__convos || {};
    globalThis.__memory = globalThis.__memory || {};
    const convos = globalThis.__convos; // per-session conversation history
    const memory = globalThis.__memory; // per-session "remember" facts

    // Simple "remember ..." feature
    if (message.toLowerCase().startsWith("remember")) {
      const fact = message.slice("remember".length).trim();
      if (!fact) return res.json({ assistantResponse: "🧠 Tell me what to remember." });

      memory[sessionId] = memory[sessionId] || [];
      memory[sessionId].push({ fact, timestamp: new Date().toISOString() });

      // keep memory bounded
      if (memory[sessionId].length > 100) memory[sessionId] = memory[sessionId].slice(-100);

      return res.json({ assistantResponse: "🧠 Got it. I'll remember that." });
    }

    // Build memory preface (this is separate from SYSTEM_PROMPT)
    const mem = memory[sessionId] || [];
    const memoryText = mem.length
      ? `The user has previously told you:\n${mem.map((m) => `- ${m.fact}`).join("\n")}\n\n`
      : "";

    // Conversation history (bounded)
    convos[sessionId] = convos[sessionId] || [];
    const history = convos[sessionId];

    const MAX_TURNS = 24; // ~12 user+assistant exchanges
    const trimmedHistory = history.slice(-MAX_TURNS);

    // Responses API input (message list)
    const input = [
      { role: "system", content: SYSTEM_PROMPT },
      ...trimmedHistory, // [{ role: "user"|"assistant", content: "..." }]
      { role: "user", content: `${memoryText}${message.trim()}` },
    ];

    // ✅ Responses API file search tool format (NOT tool_resources)
    const tools = VECTOR_STORE_ID
      ? [{ type: "file_search", vector_store_ids: [VECTOR_STORE_ID] }]
      : [];

    const payload = {
      model: MODEL,
      input,
      ...(tools.length ? { tools } : {}),
      ...(debug ? { include: ["file_search_call.results"] } : {}),
    };

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await upstream.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(500).json({
        error: "Non-JSON response from upstream",
        status: upstream.status,
        body: text.slice(0, 700),
      });
    }

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: "OpenAI error",
        details: data?.error || data,
      });
    }

    const assistantResponse = (extractOutputText(data) || "…").trim();

    // Update conversation cache
    history.push({ role: "user", content: message.trim() });
    history.push({ role: "assistant", content: assistantResponse });
    if (history.length > MAX_TURNS) convos[sessionId] = history.slice(-MAX_TURNS);

    return res.status(200).json({
      assistantResponse,
      ...(debug
        ? {
            debug: {
              usedVectorStore: Boolean(VECTOR_STORE_ID),
              vectorStoreId: VECTOR_STORE_ID,
              model: MODEL,
              responseId: data.id,
            },
          }
        : {}),
    });
  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      message: err?.message || String(err),
    });
  }
}
