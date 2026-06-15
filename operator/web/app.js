// Minimal single-user client. Token is stored locally so you only enter it once.

const $ = (s) => document.querySelector(s);
const feed = $("#feed");
const statusEl = $("#status");
const handoff = $("#handoff");
const handoffMsg = $("#handoff-msg");
const tokenInput = $("#token");
const goalInput = $("#goal");

tokenInput.value = localStorage.getItem("op_token") || "";
tokenInput.addEventListener("change", () => localStorage.setItem("op_token", tokenInput.value));

let es = null;

function setStatus(label, cls = "") {
  statusEl.textContent = label;
  statusEl.className = "pill " + cls;
}

function addEvent(evt) {
  const div = document.createElement("div");
  div.className = "evt " + (evt.kind || "");
  const k = document.createElement("div");
  k.className = "k"; k.textContent = evt.kind;
  div.appendChild(k);
  const pre = document.createElement("pre");
  const { t, kind, ...rest } = evt;
  pre.textContent = Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "";
  div.appendChild(pre);
  feed.appendChild(div);
  feed.scrollTop = feed.scrollHeight;

  if (evt.kind === "handoff") {
    handoffMsg.textContent = evt.instruction || "Please assist.";
    handoff.hidden = false;
    setStatus("handoff", "handoff");
  } else if (evt.kind === "done") {
    setStatus("done", "running");
  } else if (evt.kind === "failed" || evt.kind === "error" || evt.kind === "cancelled") {
    setStatus(evt.kind, "error");
  } else if (evt.kind === "started") {
    setStatus("running", "running");
  }
}

function connectStream(token) {
  if (es) es.close();
  es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  es.onmessage = (m) => { try { addEvent(JSON.parse(m.data)); } catch {} };
  es.onerror = () => setStatus("disconnected", "error");
}

async function api(path, body) {
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "X-Operator-Token": tokenInput.value,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!tokenInput.value) { tokenInput.focus(); return; }
  feed.innerHTML = "";
  handoff.hidden = true;
  connectStream(tokenInput.value);
  try {
    await api("/api/task", { goal: goalInput.value });
    goalInput.value = "";
  } catch (err) {
    addEvent({ kind: "error", error: String(err) });
  }
});

$("#resume").addEventListener("click", async () => {
  handoff.hidden = true;
  setStatus("running", "running");
  await api("/api/resume", {});
});

$("#cancel").addEventListener("click", async () => {
  try { await api("/api/cancel", {}); } catch {}
});

// Reconnect stream on load if a token is present.
if (tokenInput.value) connectStream(tokenInput.value);
