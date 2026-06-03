import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) throw redirect({ to: "/chat" });
  },
  head: () => ({ meta: [
    { title: "Operator — Autonomous web tasks" },
    { name: "description", content: "Chat-driven AI that plans and executes tasks on the web for you, powered by Mistral Large 3 and Devstral 2." },
  ]}),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="px-6 py-4 flex items-center justify-between">
        <span className="font-semibold tracking-tight">Operator</span>
        <Link to="/auth" className="text-sm rounded-md bg-primary text-primary-foreground px-3 py-1.5 hover:bg-primary/90">Sign in</Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-6">
        <div className="max-w-2xl text-center">
          <h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">Your autonomous web operator.</h1>
          <p className="mt-4 text-muted-foreground">
            Tell it a task. It asks what it needs, proposes a plan, waits for your approval, then drives a real browser to get it done.
            Powered by Mistral Large 3 — and Devstral 2 for anything code.
          </p>
          <Link to="/auth"
            className="mt-8 inline-flex rounded-md bg-primary text-primary-foreground px-5 py-2.5 text-sm font-medium hover:bg-primary/90">
            Get started →
          </Link>
        </div>
      </main>
    </div>
  );
}
