import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const sendSchema = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().min(1).max(20000),
});

export const sendMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => sendSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { mistralChat, TOOLS, SYSTEM_PROMPT, PRIMARY_MODEL } = await import("./mistral.server");
    const { runTool } = await import("./tools.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1. Ensure conversation
    let convId = data.conversationId;
    if (!convId) {
      const { data: c, error } = await supabase
        .from("conversations")
        .insert({ user_id: userId, title: data.message.slice(0, 60) })
        .select("id")
        .single();
      if (error) throw new Error(error.message);
      convId = c.id;
    }

    // 2. Load conversation (for custom_instructions) + user playwright url
    const { data: convRow } = await supabase
      .from("conversations")
      .select("custom_instructions")
      .eq("id", convId!)
      .maybeSingle();
    const customInstructions = convRow?.custom_instructions?.trim() || "";

    const { data: prof } = await supabase.from("profiles").select("playwright_server_url").eq("id", userId).maybeSingle();
    const playwrightUrl = prof?.playwright_server_url ?? null;

    // 3. Persist user message
    await supabase.from("messages").insert({
      conversation_id: convId,
      user_id: userId,
      role: "user",
      content: data.message,
    });

    // 4. Load history
    const { data: history } = await supabase
      .from("messages")
      .select("role, content, tool_calls, tool_call_id, name")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });

    const systemContent = customInstructions
      ? `${SYSTEM_PROMPT}\n\n=== USER'S CUSTOM INSTRUCTIONS FOR THIS CHAT (always follow these in addition to the above) ===\n${customInstructions}`
      : SYSTEM_PROMPT;
    const apiMessages: any[] = [{ role: "system", content: systemContent }];

    for (const m of history ?? []) {
      const row: any = { role: m.role, content: m.content ?? "" };
      if (m.tool_calls) row.tool_calls = m.tool_calls;
      if (m.tool_call_id) row.tool_call_id = m.tool_call_id;
      if (m.name) row.name = m.name;
      apiMessages.push(row);
    }

    // 5. Tool-calling loop (max 6 iterations)
    let finalText = "";
    let lastModel = PRIMARY_MODEL;
    for (let i = 0; i < 6; i++) {
      const resp = await mistralChat({
        model: PRIMARY_MODEL,
        messages: apiMessages,
        tools: TOOLS,
      });
      const msg = resp?.choices?.[0]?.message;
      if (!msg) break;

      // Persist assistant message
      const assistantRow: any = {
        conversation_id: convId!,
        user_id: userId,
        role: "assistant",
        content: msg.content ?? "",
        model: PRIMARY_MODEL,
        tool_calls: msg.tool_calls ?? null,
      };
      await supabase.from("messages").insert(assistantRow);
      apiMessages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        finalText = msg.content ?? "";
        break;
      }

      // Execute each tool call
      for (const tc of msg.tool_calls) {
        const fn = tc.function?.name as string;
        let parsed: any = {};
        try { parsed = JSON.parse(tc.function?.arguments ?? "{}"); } catch {}

        const result = await runTool(fn, parsed, { userId, playwrightUrl, supabaseAdmin });

        if (fn === "delegate_to_devstral") lastModel = "devstral-medium-latest";

        // If propose_task_plan, also persist as a task row
        if (fn === "propose_task_plan" && result.ok) {
          await supabase.from("tasks").insert({
            conversation_id: convId!,
            user_id: userId,
            goal: parsed.goal ?? "",
            plan: parsed,
            mode: parsed.mode ?? "one_time",
            total_steps: Array.isArray(parsed.steps) ? parsed.steps.length : 0,
            status: "awaiting_approval",
          });
        }

        const toolContent = JSON.stringify(result).slice(0, 12000);
        await supabase.from("messages").insert({
          conversation_id: convId!,
          user_id: userId,
          role: "tool",
          content: toolContent,
          tool_call_id: tc.id,
          name: fn,
        });
        apiMessages.push({ role: "tool", content: toolContent, tool_call_id: tc.id, name: fn });
      }
    }

    // Touch conversation
    await supabase.from("conversations").update({ updated_at: new Date().toISOString() }).eq("id", convId);

    return { conversationId: convId, content: finalText, lastModel };
  });

export const listConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("conversations")
      .select("id, title, status, task_mode, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { conversations: data ?? [] };
  });

export const getConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: conv, error } = await context.supabase
      .from("conversations").select("*").eq("id", data.id).maybeSingle();
    if (error) throw new Error(error.message);
    const { data: msgs } = await context.supabase
      .from("messages").select("*").eq("conversation_id", data.id).order("created_at", { ascending: true });
    const { data: tasks } = await context.supabase
      .from("tasks").select("*").eq("conversation_id", data.id).order("created_at", { ascending: true });
    return { conversation: conv, messages: msgs ?? [], tasks: tasks ?? [] };
  });

export const approveTask = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ taskId: z.string().uuid(), approved: z.boolean() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("tasks")
      .update({ approved: data.approved, status: data.approved ? "running" : "rejected" })
      .eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const setTaskStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({
    taskId: z.string().uuid(),
    status: z.enum(["running", "paused", "completed", "cancelled"]),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("tasks").update({ status: data.status }).eq("id", data.taskId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("conversations").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateConversation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({
      id: z.string().uuid(),
      title: z.string().min(1).max(200).optional(),
      custom_instructions: z.string().max(8000).nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const patch: any = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.custom_instructions !== undefined) patch.custom_instructions = data.custom_instructions;
    const { error } = await context.supabase.from("conversations").update(patch).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });


export const updatePlaywrightUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ url: z.string().url().or(z.literal("")) }).parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ playwright_server_url: data.url || null })
      .eq("id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const getProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles").select("*").eq("id", context.userId).maybeSingle();
    return { profile: data };
  });
