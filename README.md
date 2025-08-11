# AI JOE — Vercel One-Click Package

Static frontend in `/public` + serverless API in `/api`.

## Deploy
1. Push to GitHub/GitLab/Bitbucket.
2. Import into Vercel (no build needed). Framework: **Other**. Output dir: leave default.
3. Set **Environment Variables**:
   - `OPENAI_API_KEY`
   - `ELEVENLABS_API_KEY`
   - `ELEVENLABS_VOICE_ID` (e.g., `Rachel`)
   - `PASSWORD` (for the login popup)
4. Optional: place your avatar model at `public/JOEAI2.glb`. If missing, the page will still load (you can add a fallback cube or update the loader).

## Local Dev
```bash
npm i -g vercel
vercel dev
```

The frontend calls same-origin routes under `/api/*`.
