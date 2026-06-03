import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  sendMessage, listConversations, getConversation,
  approveTask, setTaskStatus, deleteConversation,
} from "@/lib/ai/chat.functions";

export const Route = createFileRoute("/_authenticated/chat/$id")({
  component: ChatPage,
});

export function ChatPage() {
  const params = useParams({ strict: false }) as { id?: string };
  const convId = params.id;
  const navigate = useNavigate();
  const qc = useQueryClient();

  const list = useServerFn(listConversations);
  const get = useServerFn(getConversation);
  const send = useServerFn(sendMessage);
  const approve = useServerFn(approveTask);
  const setStatus = useServerFn(setTaskStatus);
  const del = useServerFn(deleteConversation);

  const convs = useQuery({ queryKey: ["convs"], queryFn: () => list() });
  const conv = useQuery({
    queryKey: ["conv", convId],
    queryFn: () => (convId ? get({ data: { id: convId } }) : Promise.resolve(null)),
    enabled: !!convId,
  });

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9 }); }, [conv.data]);

  const sendMut = useMutation({
    mutationFn: (message: string) =>
      send({ data: { conversationId: convId, message } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["convs"] });
      if (r.conversationId !== convId) {
        navigate({ to: "/chat/$id", params: { id: r.conversationId } });
      } else {
        qc.invalidateQueries({ queryKey: ["conv", convId] });
      }
    },
  });

  async function logout() {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-72 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between">
          <Link to="/chat" className="font-semibold">Operator</Link>
          <Link to="/settings" className="text-xs text-muted-foreground hover:text-foreground">Settings</Link>
        </div>
        <button
          onClick={() => navigate({ to: "/chat" })}
          className="m-3 rounded-md bg-primary text-primary-foreground text-sm py-2 hover:bg-primary/90">
          + New conversation
        </button>
        <div className="flex-1 overflow-y-auto px-2">
          {convs.data?.conversations.map((c: any) => (
            <div key={c.id} className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm ${convId === c.id ? "bg-accent" : "hover:bg-accent/50"}`}>
              <Link to="/chat/$id" params={{ id: c.id }} className="flex-1 truncate">{c.title}</Link>
              <button
                onClick={async () => { await del({ data: { id: c.id } }); qc.invalidateQueries({ queryKey: ["convs"] }); if (convId === c.id) navigate({ to: "/chat" }); }}
                className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive ml-2">✕</button>
            </div>
          ))}
        </div>
        <button onClick={logout} className="m-3 text-xs text-muted-foreground hover:text-foreground text-left">Sign out</button>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col">
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto p-6 space-y-4">
            {!convId && (
              <div className="text-center text-muted-foreground py-20">
                <h1 className="text-2xl font-semibold text-foreground">What should I do for you?</h1>
                <p className="text-sm mt-2">I'll ask a few questions, propose a plan, then execute it for you.</p>
              </div>
            )}
            {conv.data?.messages
              ?.filter((m: any) => m.role === "user" || (m.role === "assistant" && (m.content || m.tool_calls)))
              .map((m: any) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-lg px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.content || <em className="text-muted-foreground">Calling tools…</em>}
                  {m.tool_calls && (
                    <div className="mt-2 text-xs opacity-70">
                      {m.tool_calls.map((tc: any) => <div key={tc.id}>→ {tc.function?.name}</div>)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {conv.data?.tasks?.map((t: any) => (
              <div key={t.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">📋 Task plan — {t.status}</h3>
                  <span className="text-xs text-muted-foreground">{t.mode === "indefinite" ? "Ongoing" : "One-time"}</span>
                </div>
                <p className="text-sm mt-2 font-medium">Goal: {t.goal}</p>
                {t.plan?.steps && (
                  <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">
                    {t.plan.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                  </ol>
                )}
                {t.plan?.risks?.length > 0 && (
                  <div className="mt-3 text-xs"><b>Risks:</b> {t.plan.risks.join("; ")}</div>
                )}
                {t.plan?.permissions?.length > 0 && (
                  <div className="text-xs"><b>Needs:</b> {t.plan.permissions.join("; ")}</div>
                )}
                {t.plan?.expected_outputs?.length > 0 && (
                  <div className="text-xs"><b>Outputs:</b> {t.plan.expected_outputs.join("; ")}</div>
                )}
                <div className="mt-3 flex gap-2">
                  {t.status === "awaiting_approval" && (
                    <>
                      <button onClick={async () => { await approve({ data: { taskId: t.id, approved: true } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md bg-primary text-primary-foreground px-3 py-1 text-xs">Approve</button>
                      <button onClick={async () => { await approve({ data: { taskId: t.id, approved: false } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1 text-xs">Reject</button>
                    </>
                  )}
                  {t.status === "running" && (
                    <>
                      <button onClick={async () => { await setStatus({ data: { taskId: t.id, status: "paused" } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1 text-xs">Pause</button>
                      <button onClick={async () => { await setStatus({ data: { taskId: t.id, status: "cancelled" } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1 text-xs">Cancel</button>
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Step {t.current_step}/{t.total_steps}</div>
              </div>
            ))}

            {sendMut.isPending && <div className="text-sm text-muted-foreground">Thinking…</div>}
          </div>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); if (input.trim() && !sendMut.isPending) { sendMut.mutate(input); setInput(""); } }}
          className="border-t border-border p-4">
          <div className="max-w-3xl mx-auto flex gap-2">
            <textarea
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.target as any).form?.requestSubmit(); } }}
              placeholder="Tell me what to do…" rows={2}
              className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <button disabled={sendMut.isPending || !input.trim()}
              className="rounded-md bg-primary text-primary-foreground px-4 text-sm disabled:opacity-50">Send</button>
          </div>
        </form>
      </main>
    </div>
  );
}
