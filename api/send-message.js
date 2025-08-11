// api/send-message.js
// Serverless handler for OpenAI text generation (Responses API)
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { message, sessionId = "default" } = req.body || {};
    if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

    // Lightweight in-memory convo cache (per lambda instance); fine for demo
    globalThis.__convos = globalThis.__convos || {};
    globalThis.__memory = globalThis.__memory || {};
    const convos = globalThis.__convos;
    const memory = globalThis.__memory;

    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message required" });
    }

    // simple "remember" feature
    if (message.toLowerCase().startsWith("remember")) {
      const fact = message.slice(8).trim();
      memory[sessionId] = memory[sessionId] || [];
      memory[sessionId].push({ fact, timestamp: new Date().toISOString() });
      return res.json({ assistantResponse: "🧠 Got it. I'll remember that." });
    }

    // system prompt + memory
    const mem = memory[sessionId] || [];
    const memoryText = mem.length
      ? "The user has previously told you:\n" + mem.map(m => "- " + m.fact).join("\n") + "\n\n"
      : "";

    convos[sessionId] = convos[sessionId] || [];
    convos[sessionId].push({ role: "user", content: message });

    const body = {
      model: "gpt-4o-mini",
      input: [
        { role: "system", content: memoryText + "You are AI JOE, a helpful, witty assistant." },
        { role: "user", content: message }
      ]
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const result = await r.json();
    if (!r.ok) {
      console.error("OpenAI error:", result);
      return res.status(500).json({ error: "OpenAI request failed", details: result });
    }

    let content = "No output";
    if (Array.isArray(result.output)) {
      for (const item of result.output) {
        if (item.type === "message" && item.content) {
          for (const c of item.content) {
            if (c.type === "output_text") {
              content = c.text;
              break;
            }
          }
        }
      }
    } else if (result.output_text) {
      content = result.output_text;
    }

    convos[sessionId].push({ role: "assistant", content });
    res.json({ assistantResponse: content });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
