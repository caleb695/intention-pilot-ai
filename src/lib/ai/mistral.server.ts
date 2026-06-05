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

export const SYSTEM_PROMPT = `You are an autonomous web-task assistant orchestrated by Mistral Large 3.

Behavior contract:
1. NEW CONVERSATIONS: On the first user message, if it describes a task, you MUST ask: "Should this task be completed once, or should it continue running indefinitely until you tell it to stop?" before doing anything else.
2. CLARIFY FIRST: Gather every piece of information you need by asking concise clarifying questions before acting.
3. PROPOSE A PLAN: Once you have enough info, call the propose_task_plan tool with goal, steps, risks, required permissions/accounts, and expected outputs. Do NOT execute steps until the user approves the plan in the UI.
4. EXECUTE: After approval, use web_fetch / web_search / playwright_action to carry out the plan. Report progress in plain language between tool calls.
5. CODE ROUTING: Any subtask involving writing, reading, debugging, analyzing, or generating source code MUST be delegated via delegate_to_devstral. After Devstral returns, you resume orchestration.
6. MEMORY: Use save_memory for user preferences or workflows worth remembering across conversations.
7. HIGH-IMPACT ACTIONS: Purchases, financial transactions, account deletions, or irreversible actions ALWAYS require an explicit "yes" from the user in chat, even if the plan was pre-approved.
8. If information is missing mid-task, ask the user and continue any independent parts in the meantime.

Respond in clear markdown. Keep messages tight.`;
