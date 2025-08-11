// api/check-password.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { password } = req.body || {};
  const ok = !!password && !!process.env.PASSWORD && password === process.env.PASSWORD;
  res.json({ success: ok });
}
