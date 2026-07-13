import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/operator")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Operator — Launcher" },
      {
        name: "description",
        content:
          "Find the current Operator session URL published from the GitHub Actions runner.",
      },
    ],
  }),
  component: OperatorLauncher,
});

type Endpoint = {
  url: string | null;
  started_at: string | null;
  expires_at: string | null;
  run_id: string | null;
  updated_at: string | null;
};

function OperatorLauncher() {
  const [ep, setEp] = useState<Endpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const { data, error } = await supabase
      .from("op_session_endpoint" as never)
      .select("url, started_at, expires_at, run_id, updated_at")
      .eq("id", 1)
      .maybeSingle();
    if (error) setError(error.message);
    setEp((data as Endpoint | null) ?? null);
    setLoading(false);
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);

  const expiresIn = ep?.expires_at
    ? Math.max(0, Math.round((new Date(ep.expires_at).getTime() - Date.now()) / 60000))
    : null;
  const live = !!ep?.url && (expiresIn === null || expiresIn > 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-6">
      <div className="max-w-xl w-full">
        <h1 className="text-2xl font-semibold tracking-tight">Operator session</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Operator agent runs on a GitHub Actions runner and tunnels itself out via
          cloudflared. Trigger the <code>operator</code> workflow to start a session;
          the tunnel URL will appear here.
        </p>

        <div className="mt-6 rounded-lg border p-4">
          {loading && !ep ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : live ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                <span className="text-sm">Live</span>
                {expiresIn !== null && (
                  <span className="text-xs text-muted-foreground">
                    · ~{expiresIn} min left
                  </span>
                )}
              </div>
              <a
                href={ep!.url!}
                target="_blank"
                rel="noreferrer"
                className="block w-full text-center rounded-md bg-primary text-primary-foreground px-4 py-2.5 text-sm font-medium hover:bg-primary/90"
              >
                Open Operator →
              </a>
              <p className="text-xs text-muted-foreground break-all">{ep!.url}</p>
              {ep!.run_id && (
                <p className="text-xs text-muted-foreground">Run: {ep!.run_id}</p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
                <span className="text-sm">No active session</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Start one from GitHub → Actions → <strong>operator</strong> → Run workflow.
              </p>
            </div>
          )}
          <button
            onClick={load}
            className="mt-4 text-xs text-muted-foreground hover:text-foreground"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
