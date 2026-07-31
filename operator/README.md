# Operator (v2)

Single-user web-automation agent. Python + FastAPI. Runs on a free
`ubuntu-latest` GitHub Actions runner behind a cloudflared quick tunnel.

Brain: **Groq Cloud** (text only). Perception: the page's accessibility/DOM
tree — no vision model, no local weights.

## Layout

```
operator/
  app/
    main.py              FastAPI entrypoint (serves API + static web/)
    config.py            env loading, constants
    loop.py              the perception → plan → act loop
    brain/
      groq.py            Groq Cloud client (planner + summariser)
      prompts.py         system prompts for planner + summarizer

    browser/
      camoufox.py        Camoufox + Playwright async driver, human timing
      profile.py         persistent profile snapshot/restore via Supabase Storage
    memory/
      supabase.py        thin client (facts, tasks, checkpoints, session_state)
      schema.sql         table DDL (run once on the Supabase project)
    api/
      routes.py          REST + SSE endpoints used by web/
  web/
    index.html           mobile-first UI (single page, no build step)
    app.js
    style.css
  scripts/
  requirements.txt
  Dockerfile               optional container (Python 3.11 + Camoufox deps)
  .env.example
```

## Local dev

```bash
cd operator
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m playwright install firefox     # Camoufox installs its own patched fox
cp .env.example .env                     # fill in SUPABASE_* and GROQ_API_KEY
uvicorn app.main:app --reload --port 7860
```

Open http://localhost:7860.

## Deploy

See `docs/GITHUB_ACTIONS.md`.

## v1 archive

The TanStack chat UI at the repo root is v1. It is kept for reference and not
deployed. Do not import from it.
