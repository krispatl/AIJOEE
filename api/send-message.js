// api/send-message.js
// Serverless handler for OpenAI text generation (Responses API) on Vercel

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message, sessionId = "default", debug = false } = req.body || {};

    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "Missing OPENAI_API_KEY" });
    }

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

      // keep memory bounded
      if (memory[sessionId].length > 100) memory[sessionId] = memory[sessionId].slice(-100);

      return res.json({ assistantResponse: "🧠 Got it. I'll remember that." });
    }

    // Build memory preface
    const mem = memory[sessionId] || [];
    const memoryText = mem.length
      ? `The user has previously told you:\n` +
        mem.map((m) => `- ${m.fact}`).join("\n") +
        `\n\n
