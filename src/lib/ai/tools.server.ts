// Tool executors. All run server-side.
import { mistralChat, CODE_MODEL } from "./mistral.server";

type ToolResult = { ok: boolean; result?: any; error?: string };

export async function runTool(
  name: string,
  args: any,
  ctx: { userId: string; playwrightUrl?: string | null; supabaseAdmin: any },
): Promise<ToolResult> {
  try {
    switch (name) {
      case "delegate_to_devstral": {
        const res = await mistralChat({
          model: CODE_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are Devstral 2, a specialist software-engineering assistant. Return precise, working code or technical analysis. No filler.",
            },
            { role: "user", content: String(args.task ?? "") + (args.language ? `\n\nLanguage: ${args.language}` : "") },
          ],
          temperature: 0.2,
        });
        const content = res?.choices?.[0]?.message?.content ?? "";
        return { ok: true, result: { devstral_response: content } };
      }

      case "web_fetch": {
        const r = await fetch(String(args.url), {
          headers: { "User-Agent": "Mozilla/5.0 LovableAgent/1.0" },
        });
        const html = await r.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 8000);
        return { ok: true, result: { url: args.url, status: r.status, text } };
      }

      case "web_search": {
        const q = encodeURIComponent(String(args.query));
        const r = await fetch(`https://duckduckgo.com/html/?q=${q}`, {
          headers: { "User-Agent": "Mozilla/5.0 LovableAgent/1.0" },
        });
        const html = await r.text();
        const items: { title: string; url: string; snippet: string }[] = [];
        const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(html)) && items.length < (args.num ?? 5)) {
          items.push({
            url: m[1],
            title: m[2].replace(/<[^>]+>/g, "").trim(),
            snippet: m[3].replace(/<[^>]+>/g, "").trim(),
          });
        }
        return { ok: true, result: { results: items } };
      }

      case "playwright_action": {
        if (!ctx.playwrightUrl) {
          return {
            ok: false,
            error:
              "No Playwright server configured. Tell the user to start their local Playwright server (see /settings) and paste its URL into their profile.",
          };
        }
        const r = await fetch(ctx.playwrightUrl.replace(/\/$/, "") + "/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(args),
        });
        const data = await r.json().catch(() => ({}));
        return { ok: r.ok, result: data, error: r.ok ? undefined : `Playwright server ${r.status}` };
      }

      case "save_memory": {
        const { error } = await ctx.supabaseAdmin.from("memories").insert({
          user_id: ctx.userId,
          kind: args.kind ?? "note",
          content: String(args.content ?? ""),
        });
        if (error) return { ok: false, error: error.message };
        return { ok: true, result: { saved: true } };
      }

      case "propose_task_plan": {
        // Surfaced to UI via persisted assistant tool_call; nothing to execute server-side.
        return { ok: true, result: { plan_surfaced: true, ...args } };
      }

      default:
        return { ok: false, error: `Unknown tool: ${name}` };
    }
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}
