import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Menu, Plus, Settings as SettingsIcon, LogOut, X, Send, Sliders, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  sendMessage, listConversations, getConversation,
  approveTask, setTaskStatus, deleteConversation, updateConversation,
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
  const updateConv = useServerFn(updateConversation);


  const convs = useQuery({ queryKey: ["convs"], queryFn: () => list() });
  const conv = useQuery({
    queryKey: ["conv", convId],
    queryFn: () => (convId ? get({ data: { id: convId } }) : Promise.resolve(null)),
    enabled: !!convId,
  });

  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [customDraft, setCustomDraft] = useState("");
  const [customSaved, setCustomSaved] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Sync draft when conversation loads / changes
  useEffect(() => {
    setCustomDraft(conv.data?.conversation?.custom_instructions ?? "");
    setCustomSaved(false);
  }, [conv.data?.conversation?.id]);


  useEffect(() => { scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }); }, [conv.data]);

  // Auto-resize textarea
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
  }, [input]);

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

  function submitInput() {
    if (input.trim() && !sendMut.isPending) {
      sendMut.mutate(input);
      setInput("");
    }
  }

  const Sidebar = (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <Link to="/chat" onClick={() => setSidebarOpen(false)} className="font-semibold text-base">Operator</Link>
        <button onClick={() => setSidebarOpen(false)} className="md:hidden p-1 -mr-1 text-muted-foreground" aria-label="Close sidebar">
          <X className="h-5 w-5" />
        </button>
      </div>
      <button
        onClick={() => { navigate({ to: "/chat" }); setSidebarOpen(false); }}
        className="m-3 flex items-center gap-2 rounded-lg border border-border bg-background hover:bg-accent text-sm py-2 px-3">
        <Plus className="h-4 w-4" /> New chat
      </button>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {convs.data?.conversations.map((c: any) => (
          <div key={c.id} className={`group flex items-center justify-between rounded-md px-2 py-2 text-sm ${convId === c.id ? "bg-accent" : "hover:bg-accent/50"}`}>
            <Link
              to="/chat/$id" params={{ id: c.id }}
              onClick={() => setSidebarOpen(false)}
              className="flex-1 truncate">{c.title}</Link>
            <button
              onClick={async () => {
                if (!confirm(`Delete "${c.title}"? This can't be undone.`)) return;
                await del({ data: { id: c.id } });
                qc.invalidateQueries({ queryKey: ["convs"] });
                if (convId === c.id) navigate({ to: "/chat" });
              }}
              className="opacity-0 group-hover:opacity-100 text-xs text-muted-foreground hover:text-destructive ml-2 px-1"
              aria-label="Delete chat">✕</button>

          </div>
        ))}
      </div>
      <div className="border-t border-border p-2 flex flex-col gap-1">
        <Link to="/settings" onClick={() => setSidebarOpen(false)} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent">
          <SettingsIcon className="h-4 w-4" /> Settings
        </Link>
        <button onClick={logout} className="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent text-left">
          <LogOut className="h-4 w-4" /> Sign out
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] w-full bg-background text-foreground overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex w-72 border-r border-border shrink-0">
        {Sidebar}
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="md:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-[82%] max-w-xs border-r border-border shadow-xl">
            {Sidebar}
          </aside>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0 gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden p-2 -ml-2 text-foreground"
            aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1 font-medium text-sm truncate">
            {conv.data?.conversation?.title || conv.data?.messages?.[0]?.content?.slice(0, 40) || "New chat"}
          </div>
          {convId && (
            <>
              <button
                onClick={() => setCustomizeOpen((v) => !v)}
                className={`p-2 rounded-md hover:bg-accent ${customizeOpen ? "bg-accent" : ""} ${conv.data?.conversation?.custom_instructions ? "text-primary" : "text-foreground"}`}
                aria-label="Customize this chat"
                title="Customize this chat">
                <Sliders className="h-4 w-4" />
              </button>
              <button
                onClick={async () => {
                  if (!confirm("Delete this chat? This can't be undone.")) return;
                  await del({ data: { id: convId } });
                  qc.invalidateQueries({ queryKey: ["convs"] });
                  navigate({ to: "/chat" });
                }}
                className="p-2 rounded-md hover:bg-accent text-foreground hover:text-destructive"
                aria-label="Delete chat"
                title="Delete chat">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={() => navigate({ to: "/chat" })}
            className="md:hidden p-2 -mr-2 text-foreground"
            aria-label="New chat">
            <Plus className="h-5 w-5" />
          </button>
        </header>

        {/* Customize-this-chat panel */}
        {convId && customizeOpen && (
          <div className="border-b border-border bg-card/50">
            <div className="max-w-3xl mx-auto px-4 py-3">
              <label className="text-xs font-medium text-muted-foreground">
                Custom instructions for THIS chat only
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Background info, persona, rules, things the AI should always remember while in this conversation.
              </p>
              <textarea
                value={customDraft}
                onChange={(e) => { setCustomDraft(e.target.value); setCustomSaved(false); }}
                rows={4}
                placeholder="e.g. Always respond in concise bullet points. My company is X. When booking flights, prefer aisle seats."
                className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm resize-y" />
              <div className="mt-2 flex items-center gap-2">
                <button
                  onClick={async () => {
                    await updateConv({ data: { id: convId, custom_instructions: customDraft || null } });
                    setCustomSaved(true);
                    qc.invalidateQueries({ queryKey: ["conv", convId] });
                  }}
                  className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs">
                  Save
                </button>
                <button
                  onClick={() => setCustomizeOpen(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-xs">
                  Close
                </button>
                {customSaved && <span className="text-xs text-muted-foreground">Saved — takes effect on your next message.</span>}
              </div>
            </div>
          </div>
        )}


        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
            {!convId && (
              <div className="text-center py-16 md:py-24">
                <h1 className="text-2xl md:text-3xl font-semibold">What should I do for you?</h1>
                <p className="text-sm text-muted-foreground mt-2">I'll figure it out and just do it. I'll ask only when I really need to.</p>
              </div>
            )}
            {conv.data?.messages
              ?.filter((m: any) => m.role === "user" || (m.role === "assistant" && (m.content || m.tool_calls)))
              .map((m: any) => (
              <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {m.content || <em className="text-muted-foreground">Working…</em>}
                  {m.tool_calls && (
                    <div className="mt-2 text-xs opacity-70">
                      {m.tool_calls.map((tc: any) => <div key={tc.id}>→ {tc.function?.name}</div>)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {conv.data?.tasks?.map((t: any) => (
              <div key={t.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-sm">Task plan — {t.status}</h3>
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
                <div className="mt-3 flex gap-2 flex-wrap">
                  {t.status === "awaiting_approval" && (
                    <>
                      <button onClick={async () => { await approve({ data: { taskId: t.id, approved: true } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs">Approve</button>
                      <button onClick={async () => { await approve({ data: { taskId: t.id, approved: false } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs">Reject</button>
                    </>
                  )}
                  {t.status === "running" && (
                    <>
                      <button onClick={async () => { await setStatus({ data: { taskId: t.id, status: "paused" } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs">Pause</button>
                      <button onClick={async () => { await setStatus({ data: { taskId: t.id, status: "cancelled" } }); qc.invalidateQueries({ queryKey: ["conv", convId] }); }}
                        className="rounded-md border border-border px-3 py-1.5 text-xs">Cancel</button>
                    </>
                  )}
                </div>
                <div className="mt-2 text-xs text-muted-foreground">Step {t.current_step}/{t.total_steps}</div>
              </div>
            ))}

            {sendMut.isPending && <div className="text-sm text-muted-foreground italic">Thinking…</div>}
          </div>
        </div>

        {/* Composer */}
        <div className="shrink-0 border-t border-border bg-background pb-[env(safe-area-inset-bottom)]">
          <form
            onSubmit={(e) => { e.preventDefault(); submitInput(); }}
            className="max-w-3xl mx-auto p-3">
            <div className="flex items-end gap-2 rounded-2xl border border-input bg-background px-3 py-2 focus-within:ring-2 focus-within:ring-ring">
              <textarea
                ref={taRef}
                value={input} onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitInput(); } }}
                placeholder="Tell me what to do…"
                rows={1}
                className="flex-1 resize-none bg-transparent text-sm outline-none py-1.5 max-h-[200px]" />
              <button
                disabled={sendMut.isPending || !input.trim()}
                className="rounded-full bg-primary text-primary-foreground p-2 disabled:opacity-40 shrink-0"
                aria-label="Send">
                <Send className="h-4 w-4" />
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
