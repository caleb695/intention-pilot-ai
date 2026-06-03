import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getProfile, updatePlaywrightUrl } from "@/lib/ai/chat.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
});

function Settings() {
  const get = useServerFn(getProfile);
  const upd = useServerFn(updatePlaywrightUrl);
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => get() });
  const [url, setUrl] = useState("");
  useEffect(() => { if (profile.data?.profile?.playwright_server_url != null) setUrl(profile.data.profile.playwright_server_url); }, [profile.data]);

  const save = useMutation({
    mutationFn: () => upd({ data: { url } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["profile"] }),
  });

  return (
    <div className="min-h-screen bg-background text-foreground p-8">
      <div className="max-w-2xl mx-auto">
        <Link to="/chat" className="text-sm text-muted-foreground hover:text-foreground">← Back to chat</Link>
        <h1 className="mt-4 text-2xl font-semibold">Settings</h1>

        <div className="mt-8 rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold">Playwright bridge</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Run the local Playwright service from the <code>playwright-server/</code> folder and paste its URL here. The AI uses it to drive a real Chromium browser on your machine.
          </p>
          <pre className="mt-3 rounded bg-muted p-3 text-xs overflow-x-auto">
{`cd playwright-server
npm install && npx playwright install chromium
npm start    # → http://localhost:8787`}
          </pre>
          <label className="block text-sm font-medium mt-4">Bridge URL</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)}
            placeholder="http://localhost:8787"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button onClick={() => save.mutate()} disabled={save.isPending}
            className="mt-3 rounded-md bg-primary text-primary-foreground px-4 py-2 text-sm disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {save.isSuccess && <span className="ml-2 text-xs text-muted-foreground">Saved</span>}
        </div>

        <div className="mt-6 rounded-lg border border-border bg-card p-6">
          <h2 className="font-semibold">Models</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Primary: <code>mistral-large-latest</code>. Auto-delegates coding tasks to <code>devstral-medium-latest</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
