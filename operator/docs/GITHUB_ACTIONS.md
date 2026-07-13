# Operator on GitHub Actions

Runs the Operator agent on a free `ubuntu-latest` runner (up to 6 hours per
session), tunnels it via `cloudflared`, and publishes the public URL into
Supabase so the phone launcher (`/operator` on the web app) can find it.

## One-time setup

1. Push this repo to GitHub (the two-way GitHub sync in Lovable is fine).
2. In the repo → **Settings → Secrets and variables → Actions → New repository
   secret**, add these as **Secrets** (not Variables):
   - `OPERATOR_TOKEN` — long random string, protects the agent's HTTP API
   - `SUPABASE_URL` — `https://qdxhttpvqhzrkhtvxcyl.supabase.co`
   - `SUPABASE_SERVICE_ROLE_KEY` — from the Lovable Cloud backend panel
   - `SUPABASE_STORAGE_BUCKET` — `operator-profile`
   - `MISTRAL_API_KEY` — from https://console.mistral.ai/api-keys
   - Optional: `MISTRAL_MODEL`, `MISTRAL_CODE_MODEL`, `MOONDREAM_QUANT`

## Start a session

GitHub → **Actions** → **operator** → **Run workflow**. Optionally set a
duration in minutes (max 350; runner hard cap is 360).

The workflow will:

1. Install deps, fetch Camoufox's Firefox build, download Moondream weights
   (both cached across runs).
2. Start `uvicorn` on port 7860.
3. Start a `cloudflared` quick tunnel and grab the `*.trycloudflare.com` URL.
4. Upsert that URL into `public.op_session_endpoint` in Supabase.
5. Hold the session open for the requested duration, then clear the URL.

## Connect from your phone

Open `https://<your-app>/operator` on your phone. The page reads the current
tunnel URL from Supabase and gives you a **Open Operator →** button. Enter
your `OPERATOR_TOKEN` once in the Operator UI and it's remembered locally.

## Caveats

- **One session at a time.** The workflow uses a `concurrency` group so a new
  run cancels the previous one.
- **Tunnel URL changes every run.** The launcher page always shows the
  latest.
- **Cold start ~2–4 min** on a cache hit (Camoufox + Moondream cached),
  ~10–15 min on a cold cache.
- **Browser profile persists** — cookies/localStorage are snapshotted to the
  `operator-profile` Supabase bucket on shutdown and restored on the next
  boot.
