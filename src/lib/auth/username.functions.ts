import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import crypto from "node:crypto";

const USERNAME_RE = /^[a-zA-Z0-9._-]{2,40}$/;
const INTERNAL_EMAIL_DOMAIN = "operator.local";

function emailForUsername(username: string) {
  return `${username.toLowerCase()}@${INTERNAL_EMAIL_DOMAIN}`;
}
function hashPassword(pw: string) {
  return crypto.createHash("sha256").update(pw).digest("hex");
}

const signupSchema = z.object({
  username: z.string().regex(USERNAME_RE, "2-40 chars, letters/numbers/._- only"),
  password: z.string().min(1).max(1024),
});

export const signupWithUsername = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => signupSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const uname = data.username.trim();
    const email = emailForUsername(uname);
    const pwHash = hashPassword(data.password);

    // Username uniqueness (case-insensitive via the lowercased synthetic email)
    const { data: existingProfile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("username", uname)
      .maybeSingle();
    if (existingProfile) throw new Error("That username is already taken.");

    // Password uniqueness (per user's explicit request)
    const { data: existingPw } = await supabaseAdmin
      .from("password_fingerprints" as any)
      .select("hash")
      .eq("hash", pwHash)
      .maybeSingle();
    if (existingPw) throw new Error("That password is already used by another account. Pick a different one.");

    // Create user
    const { data: created, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username: uname, display_name: uname },
    });
    if (error || !created.user) throw new Error(error?.message || "Failed to create account");

    // Record password fingerprint
    await supabaseAdmin.from("password_fingerprints" as any).insert({ hash: pwHash, user_id: created.user.id });

    // Ensure profile has username (trigger should, but be defensive)
    await supabaseAdmin.from("profiles").upsert({ id: created.user.id, username: uname, display_name: uname });

    return { email };
  });

const loginSchema = z.object({ username: z.string().min(1).max(64) });

export const lookupLoginEmail = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => loginSchema.parse(d))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("id, username")
      .ilike("username", data.username.trim())
      .maybeSingle();
    if (!prof?.username) throw new Error("No account with that username.");
    return { email: emailForUsername(prof.username) };
  });
