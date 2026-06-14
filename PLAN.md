# Operator — Architecture Plan (v2)

A single-user web-automation agent. Runs on Hugging Face Spaces free CPU tier.
Frontend is mobile-first (iPhone), served from the same Space.

## Brain: split-model architecture (Plan C)

Two models, each doing what it's actually good at.

### Eyes — Moondream 2 (local)
- ~1.9B params, int8 ≈ 2 GB RAM, int4 ≈ 1 GB. Fits HF free CPU (2 vCPU / 16 GB).
- 2–5 s per inference on CPU. Usable for a clicker agent.
- Native `point` and `detect` skills: "where is the submit button in this
  screenshot?" → returns coordinates. Purpose-built for browser grounding.
- Runs in-process with the browser. Screenshots never leave the box.
- Job: perception only. Given a screenshot + a small question, return
  structured facts (coordinates, visible text snippets, element labels,
  page-state booleans). No planning, no long reasoning.

### Brain — Mistral Large (text-only API, free tier)
- Gets: user goal, current task state, Moondream's structured output,
  page text extracted by Camoufox, relevant rows from Supabase memory.
- Decides: the next single action (click here, type this, scroll, wait,
  hand off to user, done).
- Text-only requests = much cheaper and faster than sending images to
  Pixtral. Free tier comfortably covers single-user usage.
- Also handles: memory queries, plan proposals, final summaries.
- Code subtasks delegate to `devstral-medium-latest` (already wired).

### Why this split
| | Local-only 8B VLM | Pixtral API only | **Moondream + text Mistral** |
|---|---|---|---|
| Per-action latency on free CPU | 15–60 s ❌ | 1–2 s | 3–6 s ✅ |
| RAM on HF free tier | ~6 GB (tight) | ~0 GB | ~1–2 GB ✅ |
| Pointing accuracy | OK | mediocre | excellent ✅ |
| Reasoning quality | mediocre | strong | strong ✅ |
| "Feels local" | yes (but slow) | no | yes ✅ |
| Cost | free | free tier then paid | free ✅ |

## Browser: Camoufox
- Patched Firefox + Playwright (Python). Real-browser fingerprint.
- Persistent profile in Supabase Storage (HF disk is ephemeral); restored
  on Space boot, snapshotted after each successful login / cookie change.
- Resource blocker (images/fonts/media) toggleable per action.
- Manual handoff for captchas / 2FA: ping the user's phone via the web UI,
  user clears it on their device, agent resumes.

## Memory & state: Supabase
- `facts` — long-term user facts/preferences (plain text rows; pgvector
  later if it grows past a few hundred).
- `tasks` — active + historical tasks, status, goal, plan.
- `checkpoints` — recovery snapshot after every action; latest 1 kept per
  task, auto-deleted on successful resume.
- `session_state` — current page URL, scroll, form values; updated hourly
  + at session restart.
- `credentials` — encrypted; only loaded into browser context on demand.

## Loop
1. Brain reads goal + memory + last checkpoint → asks Eyes a specific
   perception question about the current screenshot.
2. Eyes returns structured JSON (coords, text, booleans).
3. Brain picks one action → Camoufox executes it (with human-timing layer).
4. Write checkpoint. Clear per-action context. Repeat.
5. Hourly: snapshot session, restart browser, restore from snapshot.

## Hosting
- HF Spaces free CPU (sleeps after 48 h idle; ~50 min request cap).
- Python + FastAPI backend, single Space.
- Mobile-first web UI served from same Space; talks to FastAPI over
  fetch/SSE.
- Single user. No concurrency, no auth beyond a shared token.

## What carries over from the current Lovable app
Almost nothing. The TanStack chat UI, Mistral wiring, and Playwright bridge
were v1 exploration. v2 is Python on HF. v1 stays in the repo as `/v1-archive`
for reference but is not deployed.
