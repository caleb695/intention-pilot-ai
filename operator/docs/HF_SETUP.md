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
   On Windows PowerShell:
   ```powershell
   -join ((1..32) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })
   ```
   Save it in your password manager.

---

## 1. What files are in the `operator/` folder

Everything the Space needs is already inside `operator/`. Do not manually
create files unless a step below tells you to.

```
operator/
├── .env.example              # template of all env vars (for local dev only)
├── .gitignore                # tells git to ignore .venv, models, env files
├── Dockerfile                # HF Space build recipe (Python 3.11 + Camoufox)
├── README.md                 # quick reference for local dev
├── requirements.txt          # Python dependencies
├── app/
│   ├── __init__.py
│   ├── main.py               # FastAPI entrypoint; serves API + web UI
│   ├── config.py             # reads all env vars into typed settings
│   ├── loop.py               # the perception → plan → act loop
│   ├── api/
│   │   └── routes.py         # REST + SSE endpoints consumed by web UI
│   ├── brain/
│   │   ├── mistral.py        # Mistral Large / Devstral clients
│   │   └── prompts.py        # system prompts for planner + summarizer
│   ├── browser/
│   │   ├── camoufox.py       # Camoufox + Playwright driver
│   │   └── profile.py        # zip/unzip profile to Supabase Storage
│   ├── eyes/
│   │   └── moondream.py      # local Moondream 2 wrapper
│   └── memory/
│       ├── schema.sql        # Supabase table DDL (run once)
│       ├── supabase.py       # thin client for facts/tasks/checkpoints/storage
│       └── __init__.py
├── docs/
│   └── HF_SETUP.md           # this file
├── scripts/
│   └── download_moondream.py # one-time Moondream weight download
└── web/
    ├── index.html            # mobile-first UI shell
    ├── app.js                # UI logic (token, SSE, chat, handoff)
    └── style.css             # UI styling
```

What you actually push to HF is the **contents of `operator/`, not the folder
itself**. The Space repo root should look exactly like the tree above (no
parent `operator/` directory in the repo).

---

## 2. Run the database schema

The agent writes to five tables in your Supabase project:

| Table | Purpose |
|---|---|
| `op_facts` | Long-term facts / preferences the agent remembers |
| `op_tasks` | Task history (goal, status, summary) |
| `op_checkpoints` | Per-task browser state so tasks can resume |
| `op_session_state` | Singleton browser session state |
| `op_credentials` | Encrypted site credentials (optional, not yet wired) |

Say "run the operator schema" in this chat and I will execute
`operator/app/memory/schema.sql` as a migration for you. The tables are
service-role-only, so they do not need RLS policies.

**How to verify it worked:**
- In the Lovable Cloud backend panel, open the **Table Editor**.
- You should see `op_facts`, `op_tasks`, `op_checkpoints`, `op_session_state`,
  and `op_credentials` in the public schema.

---

## 3. Create the Storage bucket

The Camoufox browser profile (cookies, localStorage) gets zipped and pushed to
a Supabase Storage bucket named `operator-profile` so it survives Space
restarts.

Say "create the operator-profile bucket" in this chat and I'll create it as a
private bucket. No public policy — only the service role reads/writes it.

**How to verify it worked:**
- In the Lovable Cloud backend panel, open **Storage**.
- You should see a bucket named `operator-profile` with visibility set to
  **Private**.

---

## 4. Create the Space on Hugging Face

1. Open https://huggingface.co/new-space
2. **Owner:** select your HF username.
3. **Space name:** `operator` (this becomes the URL slug; you can pick any
   unused name).
4. **License:** leave blank or pick **other**.
5. **Space SDK:** select **Docker** → **Blank**.
   - Do not pick Gradio, Streamlit, or Static.
   - We need Docker because we run FastAPI + a custom Firefox build.
6. **Space hardware:** select **CPU basic — free**.
7. **Visibility:** select **Private**.
   - Only you will use it, so keep it private.
8. Click **Create Space**.

After creation, you land on an empty repo with a placeholder `README.md`.
The URL will be `https://huggingface.co/spaces/<your-username>/operator`.

---

## 5. Push the `operator/` folder to the Space as the repo root

The Space is just a git repo. You need to copy the contents of your local
`operator/` folder into that repo and push it. The key detail: **the repo
root must contain `Dockerfile`, `requirements.txt`, `app/`, `web/`, etc.** —
not a subfolder named `operator/`.

### Option A: one-time manual push (recommended for first deploy)

Open a terminal on your local machine and run:

```bash
# 1. Make a clean folder for the Space repo
mkdir -p ~/hf-operator

# 2. Clone the empty Space repo
# Replace <your-username> and <space-name> with your actual values.
git clone https://huggingface.co/spaces/<your-username>/<space-name> ~/hf-operator

# 3. Copy the contents of the operator/ folder into the repo root.
# Replace /path/to/lovable-project with wherever this project lives locally.
cp -R /path/to/lovable-project/operator/* ~/hf-operator/

# 4. Go into the repo
cd ~/hf-operator

# 5. Initialize git LFS (optional but recommended for large files later)
git lfs install

# 6. Add everything
git add .

# 7. Commit
git commit -m "Initial Operator deploy"

# 8. Push to HF
# When prompted, use your HF username and an access token with write scope.
# Get a token at https://huggingface.co/settings/tokens (click New token → write role).
git push
```

After the push, HF will detect `Dockerfile` and start building.

### Option B: use the helper script

Copy the file `operator/scripts/push_to_hf.sh` to the project root and run it:

```bash
# From the project root (where the operator/ folder lives)
chmod +x operator/scripts/push_to_hf.sh
./operator/scripts/push_to_hf.sh <your-username> <space-name>
```

The script does the same steps as Option A. It will ask you to enter your HF
access token when it pushes.

### What a successful push looks like

In your Space on HF, the **Files** tab should show:

```
Dockerfile
README.md
requirements.txt
app/
docs/
scripts/
web/
```

If you see an extra `operator/` folder at the top level, you pushed the folder
instead of the contents. Delete the repo contents and repeat the `cp -R .../*`
step without the `operator/` parent.

### Build time

First build takes **10–20 minutes** because HF is installing Python packages,
PyTorch CPU, and downloading Camoufox's patched Firefox. Watch the **Logs**
tab; you will see progress output.

---

## 6. Set the Space secrets

Secrets are encrypted env vars that the Space injects into the running
container. You must add them through the HF website UI, not in any file in
the repo.

### Step-by-step

1. Open your Space: `https://huggingface.co/spaces/<your-username>/<space-name>`
2. Click the **Settings** tab.
3. In the left sidebar, click **Variables and secrets**.
4. Click **New secret**.
5. Fill in each secret below. **Important:** choose **Secret** from the
   dropdown, not **Variable**. Variables are publicly visible.
6. After adding all secrets, scroll up and click **Restart this Space** so the
   container sees them.

### Required secrets

| Secret name | Value | Where to get it |
|---|---|---|
| `OPERATOR_TOKEN` | the long random string from step 0 | you generated it |
| `SUPABASE_URL` | `https://qdxhttpvqhzrkhtvxcyl.supabase.co` | Lovable Cloud backend panel → API settings |
| `SUPABASE_SERVICE_ROLE_KEY` | (service-role key) | Lovable Cloud backend panel → API settings |
| `SUPABASE_STORAGE_BUCKET` | `operator-profile` | exactly this string |
| `MISTRAL_API_KEY` | (your key) | https://console.mistral.ai/api-keys |

### Optional override secrets

| Secret name | Default value | When to change |
|---|---|---|
| `MISTRAL_MODEL` | `mistral-large-latest` | use `mistral-small-latest` to save quota |
| `MISTRAL_CODE_MODEL` | `devstral-medium-latest` | code-generation submodel |
| `MOONDREAM_QUANT` | `int8` | `int4` if you hit RAM limits |
| `MAX_STEPS_PER_TASK` | `200` | lower for safety while testing |
| `SESSION_RESTART_SECONDS` | `3600` | browser restart interval |

### How to verify secrets loaded

After the Space restarts, open the **Logs** tab. You should **not** see a line
like `MISTRAL_API_KEY not set`. If you see that, the secret is missing or
was added as a **Variable** instead of a **Secret**.

---

## 7. Download Moondream weights inside the Space

The Moondream 2 model weights (~2 GB) are deliberately **not** baked into the
Dockerfile. They are downloaded once onto the Space's persistent disk.

### Option A: persistent disk download (recommended)

Free CPU Spaces do get some persistent storage, but the Files tab terminal may
not always be available. The most reliable method is to temporarily add a
single line to `Dockerfile`.

1. On your local machine, edit `operator/Dockerfile`.
2. Add this line right after `RUN python -m camoufox fetch`:

   ```dockerfile
   RUN python scripts/download_moondream.py
   ```

3. Save, commit, and push again:

   ```bash
   cd ~/hf-operator
   git add Dockerfile
   git commit -m "Download Moondream weights"
   git push
   ```

4. Wait for the build to finish. The logs will show the download progress.
5. After the build succeeds, **remove that line** from `Dockerfile`, commit,
   and push again:

   ```bash
   # remove the line
   git add Dockerfile
   git commit -m "Remove one-time weight download"
   git push
   ```

The weights are now cached in `/data/hf` and will survive future deploys.

### Option B: if the Space has a Files tab terminal

1. Open the Space → **Files** tab.
2. Click the terminal icon (if present on the free tier).
3. Run:

   ```bash
   python scripts/download_moondream.py
   ```

### How to verify

In the **Files** tab, you should see a folder like `models/moondream2/` or
`/data/hf/hub/models--vikhyatk--moondream2/`. If the model is missing, the
first inference will take ~3 minutes while it downloads.

---

## 8. Smoke test

1. Open the Space URL in your phone's browser:
   `https://<your-username>-<space-name>.hf.space`
2. You will see a single input asking for the **Operator token**. Paste the
   `OPERATOR_TOKEN` value from step 0. The token is saved in your phone's
   localStorage, so you only enter it once.
3. Type a tiny goal, e.g.:
   ```
   go to example.com and tell me the page title
   ```
4. Tap **Go**.
5. Watch the event feed. You should see:
   - `started`
   - `action: goto`
   - `action: ask_eyes`
   - `action: done`

If the first `ask_eyes` action takes ~60 seconds, that's Moondream warming
up. Subsequent inferences are usually 2–5 seconds.

---

## 9. When the agent pauses for handoff

If the agent hits a captcha, login, or 2FA prompt, it emits a `handoff` event
and stops. The UI will show the handoff message and a **"I'm done — resume"**
button.

Because the browser lives in the Space, you don't see it directly. The current
workflow is:

1. Open the same site on your phone or desktop.
2. Complete the human step (solve the captcha, log in, enter 2FA).
3. Tap **"I'm done — resume"** in the Operator UI.

The agent's browser will pick up the cookies via the persistent profile.

> Future improvement: I can wire profile push-on-handoff so your phone's
> session syncs into the Space faster.

---

## 10. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Build fails on `python -m camoufox fetch` | transient HF network hiccup | In Space settings, click **Factory rebuild** |
| `401 Bad token` in UI | token mismatch | Clear browser localStorage for the Space URL and re-enter the token |
| `MISTRAL_API_KEY not set` in logs | secret missing or added as **Variable** | Re-add it as **Secret** and restart the Space |
| OOM killed in logs | Moondream int8 is too large | Set `MOONDREAM_QUANT=int4` and restart |
| Space takes 60+ s to respond | free Space was sleeping | first request after sleep wakes it; be patient |
| `operator-profile` bucket not found | bucket missing or name mismatch | Verify the bucket exists and `SUPABASE_STORAGE_BUCKET=operator-profile` |
| Repo root shows an `operator/` folder | you pushed the folder instead of its contents | Empty the repo and re-run the `cp -R .../*` command |

---

## What I'll do for you when you're ready

Just say the word and I will:
1. Run the schema migration against your Supabase project.
2. Create the `operator-profile` storage bucket.
3. Debug any build or runtime logs you paste back.

Steps 4–7 (creating the Space, pushing, adding secrets, downloading weights)
happen on your Hugging Face account — I can't click through huggingface.co for
you, but I can fix any errors you paste from the Logs tab.
