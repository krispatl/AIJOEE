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

  // Most common
  if (typeof resp.output_text === "string" && resp.output_text.trim()) {
    return resp.output_text;
  }

  // Fallback: scan output array
  const output = resp.output || resp.outputs || [];
  for (const item of output) {
    const content = item?.content || [];
    for (const c of content) {
      if ((c?.type === "output_text" || c?.type === "text") && typeof c?.text === "string") {
        return c.text;
      }
      if (c?.type === "message" && Array.isArray(c?.content)) {
        const inner = c.content.find((x) => (x?.type === "output_text" || x?.type === "text") && x?.text);
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

    // Vercel may give req.body as object OR string
    const body = safeJsonParse(req.body) || req.body || {};
    const { message, sessionId = "default", debug = false } = body;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || null;
    const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
    const SYSTEM_PROMPT =
      process.env.SYSTEM_PROMPT ||
      "You are a helpful assistant. Answer clearly and accurately. Use provided context when available.";

    // In-memory caches (scoped to the lambda instance)
    globalThis.__convos = globalThis.__convos || {};
    globalThis.__memory = globalThis.__memory || {};
    const convos = globalThis.__convos;
    const memory = globalThis.__memory;

    // "remember ..." feature
    if (message.toLowerCase().startsWith("remember")) {
      const fact = message.slice("remember".length).trim();
      if (!fact) return res.json({ assistantResponse: "🧠 Tell me what to remember." });

      memory[sessionId] = memory[sessionId] || [];
      memory[sessionId].push({ fact, timestamp: new Date().toISOString() });

      if (memory[sessionId].length > 100) memory[sessionId] = memory[sessionId].slice(-100);

      return res.json({ assistantResponse: "🧠 Got it. I'll remember that." });
    }

    // Memory preface
    const mem = memory[sessionId] || [];
    const memoryText = mem.length
      ? `The user has previously told you:\n${mem.map((m) => `- ${m.fact}`).join("\n")}\n\n`
      : "";

    // Conversation history
    convos[sessionId] = convos[sessionId] || [];
    const history = convos[sessionId];

    // Keep last N turns
    const MAX_TURNS = 24; // 12 exchanges
    const trimmedHistory = history.slice(-MAX_TURNS);

    // Responses API input (message list)
    const input = [
      { role: "system", content: SYSTEM_PROMPT },
      ...trimmedHistory, // [{role:'user'|'assistant', content:'...'}]
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

    const resp = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    const text = await resp.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // OpenAI should always return JSON, but just in case:
      return res.status(500).json({
        error: "Non-JSON response from upstream",
        status: resp.status,
        body: text.slice(0, 500),
      });
    }

    if (!resp.ok) {
      return res.status(resp.status).json({
        error: "OpenAI error",
        details: data?.error || data,
      });
    }

    const assistantResponse = (extractOutputText(data) || "…").trim();

    // Update convo cache
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
