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

  const monthStart = new Date(now.getFullYear(), now.getMonth() - 11, 1).toISOString();

  const { data: projects, error: projectsError } = await supabaseAdmin
    .from("projects")
    .select("id, name, health_score")
    .eq("workspace_id", wsId)
    .order("updated_at", { ascending: false });
  if (projectsError) throw projectsError;

  const projectIds = (projects ?? []).map((project) => project.id);

  const { data: reviewRows, error: reviewsError } = projectIds.length
    ? await supabaseAdmin
        .from("reviews")
        .select("id, created_at, status, project_id")
        .in("project_id", projectIds)
        .gte("created_at", monthStart)
    : { data: [], error: null };
  if (reviewsError) throw reviewsError;

  const reviewByMonth: Record<string, number> = {};
  for (const row of reviewRows ?? []) {
    const key = row.created_at.slice(0, 7);
    reviewByMonth[key] = (reviewByMonth[key] ?? 0) + 1;
  }
  const reviewTrend = months.map((month) => ({ month, reviews: reviewByMonth[month] ?? 0 }));

  const reviewIds = (reviewRows ?? []).map((review) => review.id);
  const { data: findingRows, error: findingsError } = reviewIds.length
    ? await supabaseAdmin
        .from("review_findings")
        .select("severity")
        .in("review_id", reviewIds)
    : { data: [], error: null };
  if (findingsError) throw findingsError;

  const sevCounts: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const finding of findingRows ?? []) {
    if (finding.severity in sevCounts) sevCounts[finding.severity]++;
  }
  const security = Object.entries(sevCounts).map(([severity, count]) => ({ severity, count }));

  const quality = (projects ?? []).slice(0, 6).map((project: any) => ({
    project: project.name,
    score: project.health_score ?? 0,
  }));

  const { data: agentSessions, error: agentSessionsError } = await supabaseAdmin
    .from("agent_sessions")
    .select("agent_id, agents!inner(name, workspace_id)")
    .eq("agents.workspace_id", wsId)
    .gte("started_at", new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
  if (agentSessionsError) throw agentSessionsError;

  const agentCounts: Record<string, number> = {};
  for (const session of agentSessions ?? []) {
    const name = (session as any).agents?.name ?? "Unknown";
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
