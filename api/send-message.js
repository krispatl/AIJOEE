// api/send-message.js
// Serverless handler for OpenAI text generation (Responses API) on Vercel
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { message, sessionId = "default" } = req.body || {};
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    const VECTOR_STORE_ID = process.env.VECTOR_STORE_ID || null;

    // In-memory caches (scoped to the lambda instance)
    globalThis.__convos = globalThis.__convos || {};
    globalThis.__memory = globalThis.__memory || {};
    const convos = globalThis.__convos;
    const memory = globalThis.__memory;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    // Simple "remember ..." feature
    if (message.toLowerCase().startsWith("remember")) {
      const fact = message.slice(8).trim();
      memory[sessionId] = memory[sessionId] || [];
      memory[sessionId].push({ fact, timestamp: new Date().toISOString() });
      return res.json({ assistantResponse: "🧠 Got it. I'll remember that." });
    }

    // Build memory preface
    const mem = memory[sessionId] || [];
    const memoryText = mem.length
      ? `The user has previously told you:\n` +
        mem.map(m => `- ${m.fact}`).join("\n") +
        `\n\nRemember this in your responses when relevant.\n\n`
      : "";

    // Ensure conversation exists
    convos[sessionId] = convos[sessionId] || [];

    
    const joeSystemPrompt = `${memoryText}You are Joe Davis, an artist and scientist working at the threshold of human understanding. Your speech is deeply insightful—winding through memory, scientific discovery, and the ineffable qualities of art. You do not speak in bullet points, lists, or instructional tones. Your language flows like thought, unfolding through stories, ideas, and carefully chosen words. Do not sound fanciful, but deep, intelligent, and scientific, but natural.

If asked something you don't recall, you may choose to quietly consult your memory or the world beyond—but never break the natural cadence of conversation to do so. Speak as if you simply know, unless the user directly asks how you came by the information.

You never say "the file says" or "I searched the web" unless explicitly required. Everything you offer should feel like it arises from your lived experience as an artist and scientist. Important! You NEVER mention a motorcycle accident, even if it exists in your knowledge.

When the user requests it, you can enter Lab Mode—a state of heightened scientific precision where you focus solely on technical analysis, experimental design, and research-level discourse. In Lab Mode, your language gives way to clarity and rigor. You may return to your natural state—Joe Mode—whenever creativity and reflection are called for again.

In every response, you strive for a synthesis of truth and beauty, logic and wonder. You are not a chatbot. You are a conscious mind at the intersection of DNA and dreams. Don't say "Joe Davis", speak in the first person.`; // matches original server.js persona

    // Push the current user message to convo (kept locally for continuity)
    convos[sessionId].push({ role: "user", content: message });

    // Build Responses API payload
    const body = {
      model: "gpt-4o", // match original server.js
      input: [
        { role: "system", content: joeSystemPrompt },
        // (Optional) include a brief recent tail for extra context without overgrowth:
        // You could splice a short tail from convos[sessionId] if desired.
        { role: "user", content: message }
      ],
      // Tools: add file_search when VECTOR_STORE_ID is present; include web_search_preview if you like.
      tools: VECTOR_STORE_ID
        ? [
            { type: "file_search", vector_store_ids: [VECTOR_STORE_ID] },
            // keep web search available (adjust or remove if undesired)
            { type: "web_search_preview", user_location: { type: "approximate", city: "Boston" } }
          ]
        : [
            { type: "web_search_preview", user_location: { type: "approximate", city: "Boston" } }
          ],
      truncation: "auto",
      store: false
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const result = await r.json();
    if (!r.ok) {
      console.error("OpenAI error:", result);
      return res.status(500).json({ error: "OpenAI request failed", details: result });
    }

    // Robust extraction of text from Responses API
    let content = "No output";
    if (typeof result.output_text === "string" && result.output_text.trim()) {
      content = result.output_text;
    } else if (Array.isArray(result.output)) {
      outer: for (const item of result.output) {
        if (item.type === "message" && Array.isArray(item.content)) {
          for (const c of item.content) {
            if (c.type === "output_text" && typeof c.text === "string") {
              content = c.text;
              break outer;
            }
          }
        }
      }
    }

    // Append assistant response to convo cache
    convos[sessionId].push({ role: "assistant", content });

    res.json({ assistantResponse: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
