import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin, supabaseOAuth } from "../config/supabase.js";
import { sendVerificationEmail, sendPasswordResetEmail } from "../services/email.js";

const r = Router();

r.post("/signup", async (req, res) => {
  const { email, password, full_name } = req.body;
  const { data: user, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    user_metadata: { full_name },
    email_confirm: false
  });
  if (error || !user?.user) return res.status(400).json({ error: error?.message || "Failed to create user" });

  // Auto-create a default workspace for the new user
  const wsName = full_name ? `${full_name.split(' ')[0]}'s Workspace` : "My Workspace";
  const { data: ws } = await supabaseAdmin.from("workspaces")
    .insert({ name: wsName, slug: `ws-${Date.now()}`, owner_id: user.user.id })
    .select().single();
  
  if (ws) {
    await supabaseAdmin.from("workspace_members").insert({
      workspace_id: ws.id, user_id: user.user.id, role: "owner"
    });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:8080';
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "signup",
    email,
    password,
    options: { redirectTo: `${appUrl}/` }
  });

  if (!linkError && linkData?.properties?.action_link) {
    await sendVerificationEmail(email, linkData.properties.action_link);
  }

  res.json({ user, session: null });
});

r.post("/signin", async (req, res) => {
  const { email, password } = req.body;
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({
    email, password
  });
  if (error) return res.status(401).json({ error: error.message });
  res.json({ user: data.user, session: data.session });
});

r.post("/reset-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email is required" });
  
  const appUrl = process.env.APP_URL || 'http://localhost:8080';
  const { data: linkData, error } = await supabaseAdmin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${appUrl}/auth/update-password` }
  });
  
  if (error) {
    // Prevent email enumeration: if the user doesn't exist, just pretend we sent it
    if (error.status === 404 || error.message.includes("not found")) {
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: error.message });
  }
  
  if (linkData?.properties?.hashed_token) {
    const actionLink = `${appUrl}/update-password?token=${linkData.properties.hashed_token}`;
    await sendPasswordResetEmail(email, actionLink);
  }
  
  res.json({ ok: true });
});

r.get("/github", async (req, res) => {
  const { data, error } = await supabaseOAuth.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${process.env.API_URL || 'http://localhost:4000'}/api/v1/auth/callback`,
      skipBrowserRedirect: true,
      scopes: "repo read:user user:email",
    }
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ url: data?.url });
});

r.get("/callback", async (req, res) => {
  const code = req.query.code as string;
  const errorParam = req.query.error as string;
  const errorDesc = req.query.error_description as string;
  const appUrl = process.env.APP_URL || 'http://localhost:8080';

  if (errorParam) {
    return res.redirect(`${appUrl}/auth?error=${encodeURIComponent(errorParam)}&error_description=${encodeURIComponent(errorDesc || '')}`);
  }

  if (!code) return res.redirect(`${appUrl}/auth?error=No+code+provided`);

  const { data, error } = await supabaseOAuth.auth.exchangeCodeForSession(code);
  if (error) return res.redirect(`${appUrl}/auth?error=${encodeURIComponent(error.message)}`);

  const userId = data.session.user.id;
  const meta   = data.session.user.user_metadata ?? {};

  // Store the user's GitHub OAuth token so we can list/push THEIR repos
  if (data.session.provider_token) {
    await supabaseAdmin.from("profiles").upsert({
      id: userId,
      github_token: data.session.provider_token,
      github_refresh_token: data.session.provider_refresh_token ?? null,
      github_username: meta.user_name ?? meta.preferred_username ?? null,
    }, { onConflict: "id" });
  }

  // First OAuth sign-in: make sure the user has a workspace
  const { data: membership } = await supabaseAdmin
    .from("workspace_members").select("workspace_id").eq("user_id", userId).limit(1).maybeSingle();
  if (!membership) {
    const fullName: string = meta.full_name ?? meta.name ?? meta.user_name ?? "";
    const wsName = fullName ? `${fullName.split(" ")[0]}'s Workspace` : "My Workspace";
    const { data: ws } = await supabaseAdmin.from("workspaces")
      .insert({ name: wsName, slug: `ws-${Date.now()}`, owner_id: userId })
      .select().single();
    if (ws) {
      await supabaseAdmin.from("workspace_members").insert({ workspace_id: ws.id, user_id: userId, role: "owner" });
    }
  }

  // Redirect back to frontend with the access_token and refresh_token in the query string
  res.redirect(`${appUrl}/auth?token=${data.session.access_token}&refresh_token=${data.session.refresh_token}`);
});

r.post("/session", requireAuth, async (req, res) => {
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("*")
    .eq("id", req.user!.id)
    .maybeSingle();
  res.json({ user: req.user, profile });
});

r.post("/logout", requireAuth, (_req, res) => res.json({ ok: true }));

r.post("/update-password", async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and password are required" });
  
  // 1. Verify the recovery token
  const { data, error } = await supabaseAdmin.auth.verifyOtp({ token_hash: token, type: 'recovery' });
  if (error || !data?.user) return res.status(400).json({ error: error?.message || "Invalid or expired token" });
  
  // 2. Update the user's password
  const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(data.user.id, { password });
  if (updateError) return res.status(400).json({ error: updateError.message });
  
  res.json({ ok: true, session: data.session, user: data.user });
});

r.post("/refresh", async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) return res.status(400).json({ error: "refresh_token is required" });

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token });
  if (error || !data.session) return res.status(401).json({ error: error?.message || "Invalid refresh token" });

  res.json({ session: data.session, user: data.user });
});

export default r;
