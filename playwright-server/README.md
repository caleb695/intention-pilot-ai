# Stealth Playwright bridge (self-hosted, single-user)

A tiny Node service that runs **on your own machine** and gives the chatbot one Chromium browser that's hard for sites to flag as a bot.

## What's in the box (and why)

- **[`patchright`](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)** — actively-maintained drop-in replacement for `playwright` that removes well-known detection leaks (`runtime.enable`, `console.debug` stack trace, headless UA, `navigator.webdriver`, etc.). Beats Cloudflare Turnstile, DataDome, and Kasada at idle far more reliably than the legacy `playwright-stealth` plugin.
- **[`ghost-cursor-playwright`](https://github.com/Niek/ghost-cursor-playwright)** — bezier-curve human-like mouse movement before clicks. Click heatmaps no longer scream "robot."
- **Manual captcha handoff** — when the agent hits a captcha / 2FA / login wall, it calls `wait_for_manual` and the bridge brings the local Chromium window to the front. You click through it in 2 seconds and the agent resumes. No paid API, no third-party token, and free 100% of the time. Since this is a single-user setup on your own machine, this is strictly better than 2captcha/CapMonster/NopeCHA for the typical case.
- **Resource blocking ("lite mode")** — when the AI calls an action with `lite: true`, the bridge drops images/fonts/media for that action, making navigation 2–5× faster on heavy pages. Auto-disabled for screenshots. Bot detectors don't flag this — real users on slow connections look the same.
- **Persistent context** at `~/.lovable-agent-chromium` so cookies, localStorage, and site trust survive restarts. Fresh-profile-every-time is itself a strong bot signal.
- **Real Chrome** via `channel: "chrome"` (not bundled Chromium) — closer fingerprint to a real user.
- **Realistic UA, locale, and host timezone**, no fixed `1280x720` viewport.
- **Per-keystroke and per-action jitter** so action timing isn't machine-perfect.

### Why these specifically (and not the others you listed)
- `playwright-stealth` / `puppeteer-extra-plugin-stealth` — outdated; many evasions are now detected. Patchright supersedes it.
- `rebrowser-playwright` — solid alternative; patchright wraps a superset of its patches.
- `camoufox` — Firefox-based, separate runtime; overkill for a single-user agent.
- `nodriver` / `patchright-python` — Python only.
- `fingerprint-generator` / `fingerprint-injector` — useful if you rotate identities; not needed for a persistent single-user profile (rotating *would* look suspicious here).
- `playwright-captcha`, `2captcha`, `CapMonster`, `NopeCHA` — paid APIs; unnecessary for a single user who can solve any captcha themselves in the visible browser window.


## Setup (one time)

```bash
cd playwright-server
npm install
npx patchright install chromium
# Recommended: also have real Google Chrome installed on the machine.
```

## Run

```bash
npm start
# → http://localhost:8787
```

Leave it running. One browser, one page, no concurrency.

## Wire it to the app

1. App → **Settings**.
2. Paste your bridge URL (default `http://localhost:8787`) and save.

## Exposing it (optional, if the app is in the cloud)

```bash
cloudflared tunnel --url http://localhost:8787
# or: ngrok http 8787
```

Use the public URL in Settings. **Only do this for yourself** — the bridge has no auth.

## Supported actions

`goto`, `click`, `fill`, `press`, `text`, `screenshot`, `evaluate`, `scroll`, `hover`, `wait`, `wait_for_manual`, `set_lite`, `close`, `reset`.

