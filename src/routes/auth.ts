import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
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
  const { data, error } = await supabaseAdmin.auth.signInWithOAuth({
    provider: "github",
    options: {
      redirectTo: `${process.env.API_URL || 'http://localhost:4000'}/api/v1/auth/callback`,
      skipBrowserRedirect: true,
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
  
  const { data, error } = await supabaseAdmin.auth.exchangeCodeForSession(code);
  if (error) return res.redirect(`${appUrl}/auth?error=${encodeURIComponent(error.message)}`);
  
  // Redirect back to frontend with the access_token in the query string
  res.redirect(`${appUrl}/auth?token=${data.session.access_token}`);
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

export default r;
