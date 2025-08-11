// api/generate-audio.js
// Serverless handler for ElevenLabs TTS -> MP3 buffer
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const { text } = req.body || {};
    if (!text) return res.status(400).json({ error: "Text required" });
    if (!process.env.ELEVENLABS_API_KEY) return res.status(500).json({ error: "Missing ELEVENLABS_API_KEY" });
    const voice = process.env.ELEVENLABS_VOICE_ID || "Rachel";

    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_multilingual_v2",
        voice_settings: { stability: 0.34, similarity_boost: 0.8 },
        serves_pro_voices: true
      })
    });

    if (!r.ok) {
      const err = await r.text();
      console.error("ElevenLabs error:", err);
      return res.status(500).json({ error: "TTS failed", details: err });
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "audio/mpeg");
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
