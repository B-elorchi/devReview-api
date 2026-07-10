import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.js";

// Admin client — bypasses RLS. Server-only.
export const supabaseAdmin: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// OAuth client — PKCE flow needs the code verifier persisted between the
// /auth/github call and the /auth/callback exchange. In-memory store works
// because both requests hit the same API process.
const oauthStore = new Map<string, string>();
export const supabaseOAuth: SupabaseClient = createClient(
  env.SUPABASE_URL,
  env.SUPABASE_ANON_KEY,
  {
    auth: {
      flowType: "pkce",
      persistSession: true,
      autoRefreshToken: false,
      storage: {
        getItem: (k: string) => oauthStore.get(k) ?? null,
        setItem: (k: string, v: string) => { oauthStore.set(k, v); },
        removeItem: (k: string) => { oauthStore.delete(k); },
      },
    },
  }
);

// Build a per-request client that acts as the signed-in user (RLS applies).
export function supabaseForUser(accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
