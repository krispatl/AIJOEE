// api/transcribe.js
// Accepts multipart/form-data with a 'audio' file (webm). Sends directly to OpenAI Whisper.
import formidable from "formidable";
import fs from "fs/promises";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  if (!process.env.OPENAI_API_KEY) return res.status(500).json({ error: "Missing OPENAI_API_KEY" });

  try {
    const form = formidable({ multiples: false });
    const { fields, files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => (err ? reject(err) : resolve({ fields, files })));
    });

    const file = files.audio;
    if (!file) return res.status(400).json({ error: "Missing 'audio' file" });

    const data = new FormData();
    data.append("file", new Blob([await fs.readFile(file.filepath)]), "audio.webm");
    data.append("model", "whisper-1");

    const r = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body: data
    });

    const json = await r.json();
    if (!r.ok) {
      console.error("Whisper error:", json);
      return res.status(500).json({ error: "Transcription failed", details: json });
    }

    res.json({ text: json.text || "" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
