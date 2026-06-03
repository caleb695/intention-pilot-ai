# Playwright bridge (self-hosted, single-user)

A tiny Node service that runs **on your own machine** and exposes one Chromium browser to the chatbot.

## Setup (one time)

```bash
cd playwright-server
npm install
npx playwright install chromium
```

## Run

```bash
npm start
# → http://localhost:8787
```

Leave it running while you use the app. One browser, one page, no concurrency.

## Wire it to the app

1. Open the app → **Settings**.
2. Paste your bridge URL (default `http://localhost:8787`) and save.
3. The AI's `playwright_action` tool will now drive that browser.

## Exposing it (optional)

If the app is running in the cloud and your bridge is local, expose it with:

```bash
# either
ngrok http 8787
# or
cloudflared tunnel --url http://localhost:8787
```

Then use the public URL in Settings. **Only do this for yourself** — the bridge has no auth.

## Supported actions

`goto`, `click`, `fill`, `press`, `text`, `screenshot`, `evaluate`, `wait`, `close`.
