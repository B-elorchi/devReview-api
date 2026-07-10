import { supabaseAdmin } from "../config/supabase.js";
import { env } from "../config/env.js";

// Prefer the user's own GitHub OAuth token (captured at login); fall back to
// the server-wide GITHUB_TOKEN so existing setups keep working.
export async function getGithubToken(userId?: string): Promise<string | null> {
  if (userId) {
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("github_token")
      .eq("id", userId)
      .maybeSingle();
    if (data?.github_token) return data.github_token;
  }
  return env.GITHUB_TOKEN || null;
}
