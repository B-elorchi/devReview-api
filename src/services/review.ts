import { supabaseAdmin } from "../config/supabase.js";
import { runAgent } from "../agents/agentFactory.js";
import { enqueueNotification } from "./notifications.js";

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

// Evict old entries after 10 minutes
function scheduleEvict(reviewId: string) {
  setTimeout(() => progressMap.delete(reviewId), 10 * 60 * 1000).unref?.();
}

// ─── Main job — reviews files one by one ──────────────────────────────────────

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

  // Split the diff into per-file sections: "=== path ===\ncontent"
  const fileSections: { path: string; content: string }[] = [];
  if (input.diff) {
    const parts = input.diff.split(/^=== (.+?) ===$/m);
    // parts = ["", path1, content1, path2, content2, ...]
    for (let i = 1; i < parts.length - 1; i += 2) {
      const path = parts[i].trim();
      const content = (parts[i + 1] ?? "").trim();
      if (path && content) fileSections.push({ path, content });
    }
  }

  const progress: ReviewProgress = {
    status: "running",
    files_total: Math.max(fileSections.length, 1),
    files_done: 0,
    current_file: null,
    findings_count: 0,
    files: fileSections.map((f) => ({ path: f.path, status: "pending", findings: 0 })),
  };
  progressMap.set(input.reviewId, progress);

  const allFindings: Finding[] = [];
  let totalTokens = 0;

  try {
    if (fileSections.length > 0) {
      // ── Review each file individually ──────────────────────────────────
      for (const [idx, file] of fileSections.entries()) {
        progress.current_file = file.path;
        progress.files[idx].status = "reviewing";

        const message = [
          `Review the file "${file.path}" and identify ALL issues: bugs, security vulnerabilities, duplicated code, performance problems, and code smells.`,
          `For EACH issue output a numbered line in exactly this format:`,
          `N. <severity emoji 🔴|🟠|🟡|🟢> **<critical|high|medium|low>** — <short issue title>`,
          `   Line: <line number>`,
          `   Fix: <one-line recommendation>`,
          `If the file is clean, reply "No issues found."`,
          ``,
          "```",
          file.content.slice(0, 40_000),
          "```",
        ].join("\n");

        let fullText = "";
        const { tokensUsed } = await runAgent({
          agentType: "code-review",
          message,
          history: [],
          onChunk: (t) => { fullText += t; },
        });
        totalTokens += tokensUsed;

        const fileFindings = parseFindings(fullText, file.path);
        allFindings.push(...fileFindings);

        progress.files[idx].status = "done";
        progress.files[idx].findings = fileFindings.length;
        progress.files_done = idx + 1;
        progress.findings_count = allFindings.length;
      }
    } else {
      // ── No diff — one general review pass ──────────────────────────────
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

    // ── Score ─────────────────────────────────────────────────────────────
    const deductions: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 1 };
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
      const highCount = allFindings.filter((f) => ["critical", "high"].includes(f.severity)).length;
      await enqueueNotification({
        userId: review.requested_by,
        type: highCount > 0 ? "alert" : "success",
        title: "Review completed",
        body: `${projectName} ${reviewLabel} — ${allFindings.length} finding(s)${highCount ? `, ${highCount} high severity` : ""}.`,
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

    // "1. 🔴 **critical** — issue title"
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
