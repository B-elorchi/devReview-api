import { randomBytes } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";
import { sendTeamInviteEmail } from "../services/email.js";
import { enqueueNotification, enqueueNotifications } from "../services/notifications.js";

const r = Router();
r.use(requireAuth);

async function enrichWorkspaceStats(ws: any) {
  const [pRes, uRes] = await Promise.all([
    supabaseAdmin.from("projects").select("*", { count: "exact", head: true }).eq("workspace_id", ws.id),
    supabaseAdmin.from("workspace_members").select("*", { count: "exact", head: true }).eq("workspace_id", ws.id),
  ]);
  
  if (pRes.error) console.error("Projects count error:", pRes.error);
  if (uRes.error) console.error("Users count error:", uRes.error);
  
  console.log(`[WorkspaceStats] ${ws.name}: Projects=${pRes.count}, Users=${uRes.count}`);
  
  return { 
    ...ws, 
    projects_count: pRes.count || 0, 
    users_count: uRes.count || 0, 
    tokens_used: 67987 // Hardcoded for screenshot purposes as requested
  };
}

r.get("/", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("*, workspace_members!inner(role)")
    .eq("workspace_members.user_id", req.user!.id);
  if (error) throw error;

  // Safety net: if the user somehow has zero workspaces, generate one dynamically.
  if (!data || data.length === 0) {
    const { data: ws } = await supabaseAdmin.from("workspaces")
      .insert({ name: "Personal Workspace", slug: `ws-${Date.now()}`, owner_id: req.user!.id })
      .select().single();
    
    if (ws) {
      await supabaseAdmin.from("workspace_members").insert({
        workspace_id: ws.id, user_id: req.user!.id, role: "owner"
      });
      const enrichedWs = await enrichWorkspaceStats({ ...ws, workspace_members: [{ role: "owner" }] });
      return res.json({ workspaces: [enrichedWs] });
    }
  }

  const enrichedData = await Promise.all(data.map(enrichWorkspaceStats));
  res.json({ workspaces: enrichedData });
});

r.post("/", async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(80), slug: z.string().min(1).max(60) }).parse(req.body);
  const { data: ws, error } = await supabaseAdmin
    .from("workspaces").insert({ name: body.name, slug: body.slug, owner_id: req.user!.id })
    .select().single();
  if (error) throw error;
  await supabaseAdmin.from("workspace_members").insert({
    workspace_id: ws.id, user_id: req.user!.id, role: "owner",
  });
  await enqueueNotification({
    userId: req.user!.id,
    type: "team",
    title: "Workspace created",
    body: `${ws.name} is ready for projects and team members.`,
    link: "/team",
  });
  res.status(201).json({ workspace: ws });
});

r.get("/:id", async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from("workspaces")
    .select("*, workspace_members!inner(role)")
    .eq("id", req.params.id)
    .eq("workspace_members.user_id", req.user!.id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "Workspace not found" });
  const enrichedWs = await enrichWorkspaceStats(data);
  res.json({ workspace: enrichedWs });
});

r.patch("/:id", async (req, res) => {
  const body = z.object({ name: z.string().min(1).max(80), slug: z.string().min(1).max(60) }).parse(req.body);
  
  // Verify user is owner or admin
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.user!.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member) return res.status(403).json({ error: "Only admins can edit workspace settings" });

  const { data: ws, error } = await supabaseAdmin
    .from("workspaces")
    .update({ name: body.name, slug: body.slug })
    .eq("id", req.params.id)
    .select()
    .single();
  if (error) throw error;
  
  await enqueueNotification({
    userId: req.user!.id,
    type: "team",
    title: "Workspace updated",
    body: `Workspace renamed to ${ws.name}.`,
    link: "/workspace",
  });
  res.json({ workspace: ws });
});

r.delete("/:id", async (req, res) => {
  // Verify user is owner
  const { data: member, error: memberErr } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.user!.id)
    .eq("role", "owner")
    .maybeSingle();
  if (memberErr) throw memberErr;
  if (!member) return res.status(403).json({ error: "Only the owner can delete the workspace" });

  const { error } = await supabaseAdmin
    .from("workspaces")
    .delete()
    .eq("id", req.params.id);
  if (error) throw error;
  
  res.status(204).end();
});

r.get("/:id/members", async (req, res) => {
  const { data: members, error } = await supabaseAdmin
    .from("workspace_members")
    .select("user_id, role, created_at")
    .eq("workspace_id", req.params.id);
  if (error) throw error;

  const userIds = [...new Set((members ?? []).map((member) => member.user_id))];
  const { data: profiles, error: profilesError } = userIds.length
    ? await supabaseAdmin
        .from("profiles")
        .select("id, full_name, avatar_url, email")
        .in("id", userIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;

  const profilesById = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  const missingProfileIds = userIds.filter((userId) => !profilesById.has(userId));

  if (missingProfileIds.length) {
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError) throw usersError;

    users
      .filter((user) => missingProfileIds.includes(user.id))
      .forEach((user) => {
        profilesById.set(user.id, {
          id: user.id,
          email: user.email ?? null,
          full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? null,
          avatar_url: user.user_metadata?.avatar_url ?? null,
        });
      });
  }

  res.json({
    members: (members ?? []).map((member) => ({
      ...member,
      profiles: profilesById.get(member.user_id) ?? null,
    })),
  });
});

r.post("/:id/members/invite", async (req, res) => {
  const body = z.object({
    email: z.string().email(),
    role: z.enum(["member", "admin", "viewer"]).default("member"),
  }).parse(req.body);

  // Supabase Admin has no direct get-by-email endpoint.
  const { data: { users }, error: listErr } = await supabaseAdmin.auth.admin.listUsers();
  if (listErr) throw listErr;

  let target = users.find((u) => u.email?.toLowerCase() === body.email.toLowerCase());
  let createdAccount = false;

  if (!target) {
    const temporaryPassword = randomBytes(24).toString("base64url");
    const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: temporaryPassword,
      email_confirm: false,
      user_metadata: {
        invited_by: req.user!.id,
        invited_workspace_id: req.params.id,
      },
    });

    if (createError || !created?.user) {
      return res.status(400).json({ error: createError?.message ?? "Failed to create invited user" });
    }

    target = created.user;
    createdAccount = true;
  }
  
  const { error } = await supabaseAdmin.from("workspace_members").upsert({
    workspace_id: req.params.id,
    user_id: target.id,
    role: body.role,
  }, { onConflict: "workspace_id,user_id" });
  if (error) throw error;

  const { error: profileError } = await supabaseAdmin.from("profiles").upsert({
    id: target.id,
    email: target.email ?? body.email,
    full_name: target.user_metadata?.full_name ?? (target.email ?? body.email).split("@")[0],
  }, { onConflict: "id", ignoreDuplicates: true });
  if (profileError) throw profileError;

  const { data: workspace, error: workspaceError } = await supabaseAdmin
    .from("workspaces")
    .select("name")
    .eq("id", req.params.id)
    .maybeSingle();
  if (workspaceError) throw workspaceError;
  const workspaceName = workspace?.name ?? "your team";
  if (createdAccount) {
    const appUrl = process.env.APP_URL || "http://localhost:8080";
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: body.email,
      options: { redirectTo: `${appUrl}/update-password` },
    });

    if (!linkError && linkData?.properties?.hashed_token) {
      const actionLink = `${appUrl}/update-password?token=${linkData.properties.hashed_token}`;
      await sendTeamInviteEmail(body.email, actionLink, workspaceName);
    }
  }

  await enqueueNotifications([
    {
      userId: target.id,
      type: "team",
      title: createdAccount ? "Account created and team invite sent" : "You were added to a workspace",
      body: createdAccount
        ? `Your DevReview AI account was created and you were invited to ${workspaceName}. Use the email link to set your password.`
        : `You were added to ${workspaceName} as ${body.role}.`,
      link: "/team",
    },
    {
      userId: req.user!.id,
      type: "success",
      title: "Team invite sent",
      body: `${body.email} was added to ${workspaceName} as ${body.role}.`,
      link: "/team",
    },
  ]);
  res.status(201).json({ status: createdAccount ? "created" : "added", user_id: target.id });
});

r.patch("/:id/members/:userId/role", async (req, res) => {
  const { role } = z.object({ role: z.enum(["member", "admin", "viewer", "owner"]) }).parse(req.body);
  const { error } = await supabaseAdmin
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.params.userId);
  if (error) throw error;
  await enqueueNotification({
    userId: req.params.userId,
    type: "team",
    title: "Workspace role updated",
    body: `Your role was changed to ${role}.`,
    link: "/team",
  });
  res.json({ ok: true });
});

r.delete("/:id/members/:userId", async (req, res) => {
  const { error } = await supabaseAdmin
    .from("workspace_members")
    .delete()
    .eq("workspace_id", req.params.id)
    .eq("user_id", req.params.userId);
  if (error) throw error;
  await enqueueNotification({
    userId: req.params.userId,
    type: "team",
    title: "Removed from workspace",
    body: "You were removed from a DevReview AI workspace.",
    link: "/team",
  });
  res.status(204).end();
});

export default r;
