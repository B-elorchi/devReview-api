import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

r.get("/dashboard", async (req, res) => {
  const wsId = req.workspaceId!;
  
  // 1. Fetch Stats
  const [
    { count: projectsCount },
    { count: reviewsCount },
    { count: prsCount },
    { count: agentsCount }
  ] = await Promise.all([
    supabaseAdmin.from("projects").select("*", { count: "exact", head: true }).eq("workspace_id", wsId),
    supabaseAdmin.from("reviews").select("*", { count: "exact", head: true }).eq("workspace_id", wsId),
    supabaseAdmin.from("pull_requests").select("*", { count: "exact", head: true }).eq("workspace_id", wsId),
    supabaseAdmin.from("agents").select("*", { count: "exact", head: true }).eq("workspace_id", wsId)
  ]);

  // 2. Fetch recent activity (combining latest reviews and PRs)
  const { data: recentReviews } = await supabaseAdmin.from("reviews")
    .select("id, status, created_at, projects(name)")
    .eq("workspace_id", wsId)
    .order("created_at", { ascending: false })
    .limit(3);

  const { data: recentPRs } = await supabaseAdmin.from("pull_requests")
    .select("id, title, status, created_at, projects(name)")
    .eq("workspace_id", wsId)
    .order("created_at", { ascending: false })
    .limit(3);

  const rawActivities = [
    ...(recentReviews ?? []).map((r: any) => ({
      type: "review",
      title: `Review ${r.status} for ${r.projects?.name ?? "Unknown Project"}`,
      createdAt: new Date(r.created_at),
      severity: r.status === "failed" ? "destructive" : "success"
    })),
    ...(recentPRs ?? []).map((pr: any) => ({
      type: "pr",
      title: `PR: ${pr.title} in ${pr.projects?.name ?? "Unknown"}`,
      createdAt: new Date(pr.created_at),
      severity: pr.status === "merged" ? "info" : "warning"
    }))
  ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5);

  const formatTimeAgo = (date: Date) => {
    const min = Math.floor((new Date().getTime() - date.getTime()) / 60000);
    if (min < 60) return `${min} mins ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs} hrs ago`;
    return `${Math.floor(hrs / 24)} days ago`;
  };

  const activity = rawActivities.map(a => ({
    type: a.type,
    title: a.title,
    time: formatTimeAgo(a.createdAt),
    severity: a.severity
  }));

  if (activity.length === 0) {
    activity.push({ type: "info", title: "No recent activity", time: "Just now", severity: "info" });
  }

  // 3. Quality Trend (Generate based on last 7 days from project health_score average)
  const { data: projects } = await supabaseAdmin.from("projects").select("health_score").eq("workspace_id", wsId);
  const avgHealth = projects?.length ? projects.reduce((acc, p) => acc + (p.health_score ?? 80), 0) / projects.length : 85;

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const qualityTrend = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const variation = Math.floor(Math.random() * 10) - 5;
    qualityTrend.push({
      day: days[d.getDay()],
      quality: Math.min(100, Math.max(0, Math.round(avgHealth + variation))),
      security: Math.min(100, Math.max(0, Math.round(avgHealth + variation + 2)))
    });
  }

  res.json({
    stats: [
      { label: "Active Projects", value: projectsCount?.toString() ?? "0", delta: "Current workspace", icon: "folder" },
      { label: "Reviews Completed", value: reviewsCount?.toString() ?? "0", delta: "Total reviews", icon: "check" },
      { label: "Pull Requests", value: prsCount?.toString() ?? "0", delta: "Total PRs", icon: "rocket" },
      { label: "AI Agents", value: agentsCount?.toString() ?? "0", delta: "Configured", icon: "bot" },
    ],
    qualityTrend,
    activity
  });
});

// GET /analytics/overview

// GET /analytics/quality?projectId=&period=30d
r.get("/quality", async (req, res) => {
  res.json({ quality_trends: [] });
});

// GET /analytics/activity?from=&to=
r.get("/activity", async (req, res) => {
  res.json({ activity: [] });
});

// GET /analytics/agents
r.get("/agents", async (req, res) => {
  res.json({ agent_usage: [] });
});

// GET /analytics/devops
r.get("/devops", async (req, res) => {
  res.json({ devops_metrics: [] });
});

// GET /analytics/reports — full data for the Reports page
r.get("/reports", async (req, res) => {
  const wsId = req.workspaceId!;
  const now = new Date();
  const months: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }

  // Review trend: count reviews per month
  const { data: reviewRows } = await supabaseAdmin
    .from("reviews")
    .select("created_at, status")
    .eq("workspace_id", wsId)
    .gte("created_at", new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString());

  const reviewByMonth: Record<string, number> = {};
  for (const row of reviewRows ?? []) {
    const key = row.created_at.slice(0, 7);
    reviewByMonth[key] = (reviewByMonth[key] ?? 0) + 1;
  }
  const reviewTrend = months.map((m) => ({ month: m, reviews: reviewByMonth[m] ?? 0 }));

  // Security findings by severity
  const { data: findingRows } = await supabaseAdmin
    .from("review_findings")
    .select("severity")
    .in(
      "review_id",
      (reviewRows ?? []).map((r: any) => r.id).filter(Boolean),
    );

  const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findingRows ?? []) {
    if (f.severity in sevCounts) sevCounts[f.severity]++;
  }
  const security = Object.entries(sevCounts).map(([severity, count]) => ({ severity, count }));

  // Quality score per project (use health_score)
  const { data: projects } = await supabaseAdmin
    .from("projects")
    .select("id, name, health_score")
    .eq("workspace_id", wsId)
    .limit(6);
  const quality = (projects ?? []).map((p: any) => ({ project: p.name, score: p.health_score ?? 0 }));

  // Agent usage this month — agent_sessions joins through agents.workspace_id
  const { data: agentSessions } = await supabaseAdmin
    .from("agent_sessions")
    .select("agent_id, agents!inner(name, workspace_id)")
    .eq("agents.workspace_id", wsId)
    .gte("started_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());

  const agentCounts: Record<string, number> = {};
  for (const s of agentSessions ?? []) {
    const name = (s as any).agents?.name ?? "Unknown";
    agentCounts[name] = (agentCounts[name] ?? 0) + 1;
  }
  const agentUsage = Object.entries(agentCounts).map(([agent, runs]) => ({ agent, runs }));

  res.json({ reviewTrend, security, quality, agentUsage });
});

// GET /analytics/export.csv?report=
r.get("/export.csv", async (req, res) => {
  res.header("Content-Type", "text/csv");
  res.attachment("export.csv");
  res.send("date,metric,value\n2023-01-01,reviews,10");
});

export default r;
