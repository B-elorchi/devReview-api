import { Router } from "express";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { supabaseAdmin } from "../config/supabase.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

// GET /analytics/dashboard
r.get("/dashboard", async (req, res) => {
  res.json({
    stats: [
      { label: "Active Projects", value: "12", delta: "+2 this week", icon: "folder" },
      { label: "Reviews Completed", value: "1,248", delta: "+18% vs last month", icon: "check" },
      { label: "Deployments", value: "342", delta: "12 active rollouts", icon: "rocket" },
      { label: "AI Agents", value: "8", delta: "All systems operational", icon: "bot" },
    ],
    qualityTrend: [
      { day: "Mon", quality: 82, security: 88 },
      { day: "Tue", quality: 84, security: 89 },
      { day: "Wed", quality: 81, security: 85 },
      { day: "Thu", quality: 85, security: 90 },
      { day: "Fri", quality: 89, security: 91 },
      { day: "Sat", quality: 88, security: 91 },
      { day: "Sun", quality: 89, security: 91 },
    ],
    activity: [
      { type: "review", title: "Security scan completed for acme/auth-service", time: "2 minutes ago", severity: "success" },
      { type: "pr", title: "PR #142 merged in acme/web-app", time: "1 hour ago", severity: "info" },
      { type: "docker", title: "Failed to build Docker image for acme/worker", time: "3 hours ago", severity: "destructive" },
      { type: "k8s", title: "Scaled api-deployment to 5 replicas", time: "Yesterday", severity: "info" },
      { type: "agent", title: "Architect agent suggested 3 optimizations", time: "Yesterday", severity: "warning" },
    ]
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
