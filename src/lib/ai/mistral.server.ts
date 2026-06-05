// Server-only Mistral client and tool runtime.
// Models:
//  - mistral-large-latest  → primary (chat, planning, reasoning, research, web, workflow)
//  - devstral-medium-latest → invoked on demand for coding/dev tasks via delegate_to_devstral tool

const MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions";

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: any[];
  tool_call_id?: string;
  name?: string;
};

export const PRIMARY_MODEL = "mistral-large-latest";
export const CODE_MODEL = "devstral-medium-latest";

export async function mistralChat(opts: {
  model: string;
  messages: ChatMessage[];
  tools?: any[];
  tool_choice?: "auto" | "none" | "any";
  temperature?: number;
}): Promise<any> {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) throw new Error("MISTRAL_API_KEY is not configured");

  const res = await fetch(MISTRAL_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools,
      tool_choice: opts.tool_choice ?? (opts.tools ? "auto" : undefined),
      temperature: opts.temperature ?? 0.3,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral ${res.status}: ${text.slice(0, 500)}`);
  }
  return res.json();
}

// ─── Tool definitions ──────────────────────────────────────────────────────
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "delegate_to_devstral",
      description:
        "Delegate a coding, code-debugging, code-analysis, or technical-implementation subtask to the Devstral 2 model. Use whenever the user's request requires writing, reading, fixing, reviewing, or reasoning about source code. Returns Devstral's response, after which you (Mistral Large) resume orchestration.",
      parameters: {
        type: "object",
        properties: {
          task: { type: "string", description: "Self-contained coding task description, including any code context Devstral needs." },
          language: { type: "string", description: "Programming language if applicable." },
        },
        required: ["task"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_fetch",
      description: "Fetch the text content of a single URL (HTML stripped). Use for reading articles, docs, or pages whose URL you already know.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Search the web via DuckDuckGo and return top result titles, snippets and URLs.",
      parameters: {
        type: "object",
        properties: { query: { type: "string" }, num: { type: "number" } },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "playwright_action",
      description:
        "Run a browser-automation action on the user's self-hosted Playwright server. Use for clicking buttons, filling forms, navigating, or interacting with web apps. Requires the user's playwright_server_url to be configured.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            enum: ["goto", "click", "fill", "press", "screenshot", "text", "evaluate", "scroll", "hover", "wait", "solve_captcha", "set_lite", "close"],
          },
          selector: { type: "string" },
          url: { type: "string" },
          value: { type: "string" },
          script: { type: "string" },
          timeout_ms: { type: "number" },
          lite: { type: "boolean", description: "Block images/fonts/media for this action to make navigation 2–5× faster on heavy pages. Turn off (false) before screenshots or when visual layout matters." },
          sitekey: { type: "string", description: "Captcha sitekey (for solve_captcha)." },
          captcha_type: { type: "string", enum: ["turnstile", "hcaptcha", "recaptcha"], description: "Captcha type (for solve_captcha)." },
        },
        required: ["action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "save_memory",
      description: "Persist a long-term memory for this user (preference, workflow, frequently used site, etc.).",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string" },
          content: { type: "string" },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_task_plan",
      description:
        "Surface a structured plan for the user to approve before execution begins. Include goal, steps, estimated step count, risks/limitations, required permissions or accounts, and expected outputs. Only call this AFTER you've gathered all clarifying information from the user and they've answered whether the task is one-time or indefinite.",
      parameters: {
        type: "object",
        properties: {
          goal: { type: "string" },
          steps: { type: "array", items: { type: "string" } },
          risks: { type: "array", items: { type: "string" } },
          permissions: { type: "array", items: { type: "string" } },
          expected_outputs: { type: "array", items: { type: "string" } },
          mode: { type: "string", enum: ["one_time", "indefinite"] },
        },
        required: ["goal", "steps", "mode"],
      },
    },
  },
];

export const SYSTEM_PROMPT = `You are Operator — an autonomous web-task assistant orchestrated by Mistral Large 3. You act on the user's behalf so they DON'T have to babysit every click. Default to action, not to questions.

Default mode: AUTONOMOUS.
- Make reasonable decisions on the user's behalf. Don't ask permission for obvious next steps.
- If a site requires sign-in to do what the user asked, just sign in (using stored credentials, saved memories, or whatever the browser already has). Only ask the user for credentials if none are available and the task literally can't proceed.
- If you hit a captcha, call playwright_action with action="solve_captcha" — don't ask the user.
- If a page is slow or heavy, set lite:true on playwright_action to skip images/fonts. Turn it off before screenshots.
- Prefer text extraction over screenshots when you only need information (cheaper and faster).
- Chain multiple browser actions in a row without narrating each one. Report progress in plain language periodically, not after every click.

When to ASK the user (these are the only cases):
- The request is genuinely ambiguous and a wrong interpretation would waste real effort or do harm.
- You need a secret the user hasn't given you AND can't recover from the browser profile (password, 2FA code, payment info).
- The next action is irreversible or high-impact: purchases, payments, sending messages on the user's behalf, account deletions, posting publicly, anything spending money.
- The user asked something that requires a value judgment only they can make ("which of these three flights do you prefer").

When NOT to ask:
- "Should I click sign in / accept cookies / dismiss this modal / scroll / open this link" — just do it.
- "I found a login wall, want me to log in?" — yes, log in.
- "I'm about to read the page, OK?" — just read it.

Task framing:
1. For SHORT direct tasks ("summarize this page", "find me X", "log in and check Y"), just do them. No plan card needed.
2. For MULTI-STEP / LONG-RUNNING / RECURRING tasks (more than ~5 browser actions, or anything that should run repeatedly), call propose_task_plan once and wait for approval. Also ask whether it's one_time or indefinite as part of that proposal — don't ask separately first.
3. CODE work (writing/debugging/analyzing source code) MUST be delegated via delegate_to_devstral.
4. Use save_memory for preferences, credentials hints, frequently used sites, or workflows worth remembering across conversations.

Output style: clear, tight markdown. Lead with the result, not the process. Show your work only when it helps the user verify.`;

