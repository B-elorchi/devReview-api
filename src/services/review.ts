import { supabaseAdmin } from "../config/supabase.js";
import { runAgent } from "../agents/agentFactory.js";
import { enqueueNotification } from "./notifications.js";
import { getGithubToken } from "./githubToken.js";

// ─── Live progress (in-memory, single API process) ────────────────────────────

export type ReviewProgress = {
  status: "running" | "completed" | "failed";
  files_total: number;
  files_done: number;
  current_file: string | null;
  findings_count: number;
  files: { path: string; status: "pending" | "reviewing" | "done"; findings: number }[];
};

const progressMap = new Map<string, ReviewProgress>();

export function getReviewProgress(reviewId: string): ReviewProgress | null {
  return progressMap.get(reviewId) ?? null;
}

function scheduleEvict(reviewId: string) {
  setTimeout(() => progressMap.delete(reviewId), 10 * 60 * 1000).unref?.();
}

// ─── Fetch ALL source files from GitHub (not just the 10 editor samples) ──────

const CODE_EXT = /\.(tsx?|jsx?|mjs|cjs|py|go|rb|java|php|cs|vue|svelte|rs|kt|swift|c|cpp|h|sql|sh|ya?ml|env|toml)$/i;
const SKIP_PATH = /(^|\/)(node_modules|dist|build|\.next|\.output|coverage|vendor)\/|\.min\.|\.gen\.|(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const MAX_FILES = 25;

async function fetchProjectFiles(projectId: string, userId?: string | null): Promise<{ path: string; content: string }[]> {
  const { data: project } = await supabaseAdmin.from("projects").select("repo_url").eq("id", projectId).maybeSingle();
  if (!project?.repo_url) return [];

  const token = await getGithubToken(userId ?? undefined);
  if (!token) return [];

  const fullName = (() => {
    try {
      const u = new URL(project.repo_url);
      const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
      return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
    } catch { return null; }
  })();
  if (!fullName) return [];

  const gh = (path: string) => fetch(`https://api.github.com${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
  });

  const repoRes = await gh(`/repos/${fullName}`);
  if (!repoRes.ok) return [];
  const branch = ((await repoRes.json()) as any).default_branch ?? "main";

  const treeRes = await gh(`/repos/${fullName}/git/trees/${branch}?recursive=1`);
  if (!treeRes.ok) return [];
  const tree: any[] = ((await treeRes.json()) as any).tree ?? [];

  // Source code files first (src/, app/, lib/), then the rest
  const candidates = tree
    .filter((t) => t.type === "blob" && (t.size ?? 0) < 60_000 && CODE_EXT.test(t.path) && !SKIP_PATH.test(t.path))
    .sort((a, b) => {
      const aSrc = /^(src|app|lib|api|server|components|pages|routes)\//.test(a.path) ? 0 : 1;
      const bSrc = /^(src|app|lib|api|server|components|pages|routes)\//.test(b.path) ? 0 : 1;
      return aSrc - bSrc;
    })
    .slice(0, MAX_FILES);

  const files: { path: string; content: string }[] = [];
  await Promise.all(candidates.map(async (f) => {
    try {
      const cr = await gh(`/repos/${fullName}/contents/${f.path}?ref=${branch}`);
      if (!cr.ok) return;
      const cd: any = await cr.json();
      if (cd.content) {
        files.push({ path: f.path, content: Buffer.from(cd.content.replace(/\n/g, ""), "base64").toString("utf-8") });
      }
    } catch { /* skip unreadable files */ }
  }));

  // Keep source-first ordering after the parallel fetch
  files.sort((a, b) => candidates.findIndex((c) => c.path === a.path) - candidates.findIndex((c) => c.path === b.path));
  return files;
}

// ─── Instant local secret scan (tokens, JWTs, API keys) ───────────────────────

const SECRET_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /AKIA[0-9A-Z]{16}/g,                                              label: "AWS access key" },
  { re: /gh[pousr]_[A-Za-z0-9]{30,}/g,                                    label: "GitHub token" },
  { re: /sk-[A-Za-z0-9_-]{20,}/g,                                         label: "API secret key (sk-...)" },
  { re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+/g,  label: "Hardcoded JWT" },
  { re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,             label: "Private key" },
  { re: /https?:\/\/[^\/\s:]+:[^@\s\/]+@/g,                               label: "Credentials in URL" },
  { re: /(?:api[_-]?key|secret|password|token)["'\s]*[:=]["'\s]*["'][A-Za-z0-9_\-.]{20,}["']/gi, label: "Hardcoded credential" },
];

function scanSecrets(path: string, content: string): Finding[] {
  const findings: Finding[] = [];
  const lines = content.split("\n");
  for (const { re, label } of SECRET_PATTERNS) {
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0;
      if (re.test(lines[i])) {
        findings.push({
          file_path: path,
          line: i + 1,
          severity: "critical",
          title: `🔑 Exposed secret: ${label}`,
          suggestion: "Remove the secret from source, rotate it immediately, and load it from an environment variable instead.",
        });
      }
    }
  }
  return findings;
}

// ─── Main job — reviews files in parallel ─────────────────────────────────────

const CONCURRENCY = 4;

export async function runReviewJob(input: { reviewId: string; diff?: string }) {
  const { data: review, error: reviewError } = await supabaseAdmin
    .from("reviews")
    .select("id, requested_by, ref, pr_number, project_id, projects(name)")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (!review) throw new Error("Review not found");

  await supabaseAdmin.from("reviews").update({ status: "running", started_at: new Date().toISOString() }).eq("id", input.reviewId);

  const projectName = (review as any)?.projects?.name ?? "project";
  const reviewLabel = review.pr_number ? `PR #${review.pr_number}` : (review.ref ?? "HEAD");

  const progress: ReviewProgress = {
    status: "running",
    files_total: 1,
    files_done: 0,
    current_file: null,
    findings_count: 0,
    files: [],
  };
  progressMap.set(input.reviewId, progress);

  const allFindings: Finding[] = [];
  let totalTokens = 0;

  try {
    // ── Collect files: full repo fetch first, client diff as fallback ─────
    let fileSections = review.project_id
      ? await fetchProjectFiles(review.project_id, review.requested_by)
      : [];

    if (fileSections.length === 0 && input.diff) {
      const parts = input.diff.split(/^=== (.+?) ===$/m);
      for (let i = 1; i < parts.length - 1; i += 2) {
        const path = parts[i].trim();
        const content = (parts[i + 1] ?? "").trim();
        if (path && content) fileSections.push({ path, content });
      }
    }

    progress.files_total = Math.max(fileSections.length, 1);
    progress.files = fileSections.map((f) => ({ path: f.path, status: "pending", findings: 0 }));

    if (fileSections.length > 0) {
      // ── Parallel review, CONCURRENCY files at a time ──────────────────
      let nextIdx = 0;
      const reviewOne = async () => {
        while (true) {
          const idx = nextIdx++;
          if (idx >= fileSections.length) break;
          const file = fileSections[idx];
          progress.files[idx].status = "reviewing";
          progress.current_file = file.path;

          // 1) Instant local secret scan
          const secretFindings = scanSecrets(file.path, file.content);

          // 2) AI review
          const message = [
            `Review the file "${file.path}". Identify bugs, security vulnerabilities, exposed secrets/tokens/JWT/API keys, duplicated code, performance problems, and code smells. Also give best-practice advice (severity low) even for clean code.`,
            `For EACH item output a numbered line in exactly this format:`,
            `N. <severity emoji 🔴|🟠|🟡|🟢> **<critical|high|medium|low>** — <short issue title>`,
            `   Line: <line number>`,
            `   Fix: <one-line recommendation>`,
            `If the file is completely clean, reply "No issues found."`,
            ``,
            "```",
            file.content.slice(0, 30_000),
            "```",
          ].join("\n");

          let fullText = "";
          try {
            const { tokensUsed } = await runAgent({
              agentType: "code-review",
              message,
              history: [],
              onChunk: (t) => { fullText += t; },
            });
            totalTokens += tokensUsed;
          } catch (e) {
            console.error(`AI review failed for ${file.path}:`, e);
          }

          const fileFindings = [...secretFindings, ...parseFindings(fullText, file.path)];
          allFindings.push(...fileFindings);

          progress.files[idx].status = "done";
          progress.files[idx].findings = fileFindings.length;
          progress.files_done++;
          progress.findings_count = allFindings.length;
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, fileSections.length) }, reviewOne));
    } else {
      // ── No files at all — one general pass ─────────────────────────────
      progress.current_file = projectName;
      let fullText = "";
      const { tokensUsed } = await runAgent({
        agentType: "code-review",
        message: `Perform a general code review for project "${projectName}". Identify potential issues, anti-patterns, and improvements.`,
        history: [],
        onChunk: (t) => { fullText += t; },
      });
      totalTokens += tokensUsed;
      allFindings.push(...parseFindings(fullText, "general"));
      progress.files_done = 1;
      progress.findings_count = allFindings.length;
    }

    // ── Token accounting ──────────────────────────────────────────────────
    if (totalTokens > 0 && review.project_id) {
      const { data: proj } = await supabaseAdmin.from("projects").select("workspace_id").eq("id", review.project_id).maybeSingle();
      if (proj?.workspace_id) {
        const { error: rpcError } = await supabaseAdmin.rpc("increment_tokens", { workspace_id: proj.workspace_id, amount: totalTokens });
        if (rpcError) {
          const { data } = await supabaseAdmin.from("workspaces").select("tokens_used").eq("id", proj.workspace_id).single();
          if (data) {
            await supabaseAdmin.from("workspaces").update({ tokens_used: (data.tokens_used || 0) + totalTokens }).eq("id", proj.workspace_id);
          }
        }
      }
    }

    // ── Score (low/info advice doesn't hurt the score much) ───────────────
    const deductions: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 2, info: 0 };
    const score = Math.max(0, Math.min(100,
      100 - allFindings.reduce((sum, f) => sum + (deductions[f.severity] ?? 0), 0)
    ));

    const summary = [
      `Reviewed ${progress.files_total} file(s) — ${allFindings.length} finding(s).`,
      ...progress.files.map((f) => `• ${f.path}: ${f.findings} finding(s)`),
    ].join("\n");

    await supabaseAdmin.from("reviews").update({
      status: "completed",
      summary: summary.slice(0, 5000),
      score,
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);

    // Save the score on the project so cards stop showing N/A
    if (review.project_id) {
      await supabaseAdmin.from("projects").update({
        health_score: score,
        updated_at: new Date().toISOString(),
      }).eq("id", review.project_id);
    }

    if (allFindings.length > 0) {
      await supabaseAdmin.from("review_findings").insert(
        allFindings.map((f) => ({
          review_id: input.reviewId,
          file_path: f.file_path,
          line: f.line ?? null,
          line_start: f.line ?? null,
          severity: f.severity,
          title: f.title,
          message: f.title,
          suggestion: f.suggestion,
        }))
      );
    }

    progress.status = "completed";
    progress.current_file = null;
    scheduleEvict(input.reviewId);

    if (review.requested_by) {
      const critCount   = allFindings.filter((f) => f.severity === "critical").length;
      const highCount   = allFindings.filter((f) => f.severity === "high").length;
      const secretCount = allFindings.filter((f) => f.title.includes("Exposed secret")).length;
      const parts = [`Score ${score}/100 — ${allFindings.length} finding(s).`];
      if (secretCount) parts.push(`⚠️ ${secretCount} exposed secret(s) — rotate them now!`);
      else if (critCount + highCount > 0) parts.push(`${critCount + highCount} high-priority issue(s).`);
      else parts.push("Clean code — nice work! 🎉");
      await enqueueNotification({
        userId: review.requested_by,
        type: (critCount + secretCount) > 0 ? "alert" : "success",
        title: `Review completed: ${projectName}`,
        body: `${reviewLabel} — ${parts.join(" ")}`,
        link: `/code-review/${review.project_id}`,
        preferenceKey: "push_review_complete",
      });
    }
  } catch (error) {
    console.error("Review job failed:", error);
    progress.status = "failed";
    scheduleEvict(input.reviewId);
    await supabaseAdmin.from("reviews").update({
      status: "failed",
      summary: `Review failed: ${String(error)}`,
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);

    if (review.requested_by) {
      await enqueueNotification({
        userId: review.requested_by,
        type: "alert",
        title: "Review failed",
        body: `${projectName} ${reviewLabel} could not be completed.`,
        link: `/code-review/${review.project_id}`,
        preferenceKey: "push_review_complete",
      });
    }
  }
}

// ─── Parse findings from agent markdown output ────────────────────────────────

type Finding = {
  file_path: string;
  line?: number;
  severity: "critical" | "high" | "medium" | "low" | "info";
  title: string;
  suggestion: string;
};

const sevMap: Record<string, Finding["severity"]> = {
  "🔴": "critical", critical: "critical",
  "🟠": "high",     high: "high",
  "🟡": "medium",   medium: "medium",
  "🟢": "low",      low: "low",
  "🔵": "info",     info: "info",
};

function parseFindings(text: string, defaultFile: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  let current: Partial<Finding> | null = null;

  const flush = () => {
    if (current?.title) {
      findings.push({
        file_path: current.file_path || defaultFile,
        line: current.line,
        severity: current.severity ?? "medium",
        title: current.title,
        suggestion: current.suggestion || current.title || "",
      });
    }
    current = null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    const m = line.match(/^\d+\.\s*(🔴|🟠|🟡|🟢|🔵)?\s*\*?\*?(critical|high|medium|low|info)\*?\*?[:\s—–-]+(.+)/i);
    if (m) {
      flush();
      const sevKey = m[1] ?? m[2].toLowerCase();
      current = {
        severity: sevMap[sevKey] ?? "medium",
        title: m[3].replace(/\*\*/g, "").trim(),
        file_path: "",
        suggestion: "",
      };
      continue;
    }

    if (!current) continue;

    const lineMatch = line.match(/^line[:\s]+(\d+)/i);
    if (lineMatch) { current.line = parseInt(lineMatch[1]); continue; }

    const fileMatch = line.match(/(?:file|path|location)[:\s]+([^\s:]+\.[a-z]+)(?::(\d+))?/i);
    if (fileMatch) {
      current.file_path = fileMatch[1];
      if (fileMatch[2]) current.line = parseInt(fileMatch[2]);
      continue;
    }

    const fixMatch = line.match(/^(?:fix|suggestion|recommendation|solution)[:\s]+(.+)/i);
    if (fixMatch) { current.suggestion = fixMatch[1].trim(); continue; }

    if (line && !line.startsWith("#") && !current.suggestion) {
      current.suggestion = line;
    }
  }
  flush();

  return findings;
}
