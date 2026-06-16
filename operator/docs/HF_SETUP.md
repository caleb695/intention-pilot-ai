# Hugging Face Spaces — Operator setup walkthrough

This is the exact click-by-click for deploying the v2 agent to a free CPU
Space. Single user, ~2 vCPU / 16 GB RAM, sleeps after 48 h of inactivity.

> Do these in order. Each step is gated on the previous one.

---

## 0. Prereqs (one-time)

You need:
1. A Hugging Face account → https://huggingface.co/join
2. A Mistral API key (free tier is fine) → https://console.mistral.ai/api-keys
3. Your Supabase project URL + service-role key. I'll point you to the right
   spot in the Lovable Cloud panel when you get to step 3.
4. A long random string to use as `OPERATOR_TOKEN` (this is the only thing
   protecting the Space — treat it like a password). On macOS/Linux:
   ```bash
   openssl rand -hex 32
   ```
   Save it in your password manager.

---

## 1. Run the database schema

The agent writes to five tables in your Supabase project: `op_facts`,
`op_tasks`, `op_checkpoints`, `op_session_state`, `op_credentials`.

I'll run the migration for you when you say "run the operator schema" — it's
just `operator/app/memory/schema.sql` wrapped in a migration call. The
tables are service-role-only, so they don't need RLS policies.

---

## 2. Create the Storage bucket

The Camoufox browser profile (cookies, localStorage) gets zipped and pushed
to a Supabase Storage bucket named `operator-profile` so it survives Space
restarts.

Say "create the operator-profile bucket" and I'll create it (private). No
public policy — only the service role reads/writes it.

---

## 3. Create the Space

1. Go to https://huggingface.co/new-space
2. **Owner:** your username.
3. **Space name:** `operator` (or whatever — it becomes the URL).
4. **License:** leave blank or pick "other".
5. **Space SDK:** **Docker** → **Blank**. (Not Gradio, not Streamlit.)
6. **Space hardware:** **CPU basic — free**.
7. **Visibility:** **Private**. Only you should reach this.
8. Click **Create Space**.

You'll land on an empty repo with a placeholder `README.md`.

---

## 4. Push the `operator/` directory to the Space

The Space is a git repo. Easiest path: push only the `operator/` subdir as
the Space root.

```bash
# from your machine, NOT the Lovable sandbox
git clone https://huggingface.co/spaces/<your-username>/operator hf-operator
cp -r path/to/this-project/operator/* hf-operator/
cd hf-operator
git lfs install                # in case weights are tracked later
git add .
git commit -m "Initial deploy"
git push
```

When prompted for credentials, use your HF username and an **access token**
with **write** scope from https://huggingface.co/settings/tokens.

The Space will detect the `Dockerfile` and start building. First build takes
~10–15 minutes (Python deps + Firefox download). Watch the **Logs** tab.

---

## 5. Set the Space secrets

In your Space → **Settings** → **Variables and secrets** → **New secret**.
Add each of these as **Secret** (not Variable — Variables are public):

| Name | Value |
|---|---|
| `OPERATOR_TOKEN` | the random string from step 0 |
| `SUPABASE_URL` | from Lovable Cloud panel |
| `SUPABASE_SERVICE_ROLE_KEY` | from Lovable Cloud panel |
| `SUPABASE_STORAGE_BUCKET` | `operator-profile` |
| `MISTRAL_API_KEY` | from console.mistral.ai |

Optional overrides (defaults are fine):

| Name | Default | When to change |
|---|---|---|
| `MISTRAL_MODEL` | `mistral-large-latest` | downgrade to `mistral-small-latest` to save quota |
| `MOONDREAM_QUANT` | `int8` | set to `int4` if RAM is tight |
| `MAX_STEPS_PER_TASK` | `200` | lower for safety while testing |
| `SESSION_RESTART_SECONDS` | `3600` | hourly browser restart |

After adding secrets, click **Restart this Space** so they take effect.

---

## 6. Download Moondream weights (one-time, in the Space)

The Dockerfile doesn't bake the weights in — they're ~2 GB and would make
every rebuild slow. Instead, run the download once on the Space's persistent
disk.

In Space → **Files** tab → click the terminal icon (if available on free
tier) **OR** add this to `Dockerfile` temporarily:

```dockerfile
RUN python scripts/download_moondream.py
```

…push, wait for the build, then remove that line and push again. Weights
land in `/data/hf` (the `HF_HOME` we set) and survive future deploys.

> If your free Space doesn't get persistent storage, the model re-downloads
> every cold start (~3 min). That's tolerable for a single user.

---

## 7. Smoke test

1. Open `https://<your-username>-operator.hf.space` on your phone.
2. Enter the `OPERATOR_TOKEN`. It's saved in localStorage — you'll only do
   this once per device.
3. Type a tiny goal: `go to example.com and tell me the page title`.
4. Watch the event feed: you should see `started` → `action: goto` →
   `action: ask_eyes` → `action: done`.

If the first action takes ~60 s, that's Moondream warming up. Subsequent
inferences are 2–5 s.

---

## 8. When the agent pauses for handoff

If the agent hits a captcha, login, or 2FA prompt, it emits a `handoff`
event and stops. You don't see the browser — instead, the agent tells you
what's blocking it (e.g. "Cloudflare turnstile on checkout page"). For
**v2 with handoff via local browser mirror**, that means: open the same
site on your phone, do the human step, then tap **"I'm done — resume"** in
the Operator UI. The agent's browser will pick up where it left off because
the cookies are shared via the persistent profile (next-step: I'll wire
profile push-on-handoff so your phone's session syncs into the Space —
that's a follow-up after first smoke test).

---

## 9. Troubleshooting

- **Build fails on `python -m camoufox fetch`** — usually a transient HF
  network hiccup. Click **Factory rebuild** in Space settings.
- **`401 Bad token`** in the UI — token in the input doesn't match
  `OPERATOR_TOKEN` secret. Clear localStorage and re-enter.
- **`MISTRAL_API_KEY not set`** in logs — you added it as a Variable, not a
  Secret. Delete and re-add as Secret.
- **OOM killed** in logs — switch `MOONDREAM_QUANT=int4` and restart.
- **Space sleeping** — free tier sleeps after 48 h idle. First request after
  sleep takes ~60 s to wake.

---

## What I'll do for you when you're ready

Just say the word and I'll:
1. Run the schema migration against your Supabase project.
2. Create the `operator-profile` storage bucket.
3. Walk you through any error you hit during steps 3–7.

Steps 3, 4, 5, 6, 7 have to happen on your HF account — I can't click
through huggingface.co for you, but I can debug logs you paste back.
