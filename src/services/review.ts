import { supabaseAdmin } from "../config/supabase.js";
import { runAgent } from "../agents/agentFactory.js";
import { enqueueNotification } from "./notifications.js";

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

  const message = input.diff
    ? `Review this code and identify all bugs, security issues, performance problems, and code smells:\n\n${input.diff.slice(0, 60_000)}`
    : `Perform a general code review for project "${projectName}". Identify potential issues, anti-patterns, and improvements.`;

  try {
    let fullText = "";
    const { tokensUsed } = await runAgent({
      agentType: "code-review",
      message,
      history: [],
      onChunk: (text) => { fullText += text; },
    });

    if (tokensUsed > 0 && review.project_id) {
      // Find workspace for this project
      const { data: proj } = await supabaseAdmin.from("projects").select("workspace_id").eq("id", review.project_id).maybeSingle();
      if (proj?.workspace_id) {
        const { error: rpcError } = await supabaseAdmin.rpc('increment_tokens', { workspace_id: proj.workspace_id, amount: tokensUsed });
        if (rpcError) {
          // Fallback if RPC doesn't exist
          const { data } = await supabaseAdmin.from("workspaces").select("tokens_used").eq("id", proj.workspace_id).single();
          if (data) {
            await supabaseAdmin.from("workspaces").update({ tokens_used: (data.tokens_used || 0) + tokensUsed }).eq("id", proj.workspace_id);
          }
        }
      }
    }

    // Parse findings from the structured markdown response
    const findings = parseFindings(fullText, input.diff);

    // Score: starts at 100, deduct per finding severity
    const deductions: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 1 };
    const score = Math.max(0, Math.min(100,
      100 - findings.reduce((sum, f) => sum + (deductions[f.severity] ?? 0), 0)
    ));

    await supabaseAdmin.from("reviews").update({
      status: "completed",
      summary: fullText.slice(0, 5000),
      score,
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);

    if (findings.length > 0) {
      await supabaseAdmin.from("review_findings").insert(
        findings.map((f) => ({
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

    if (review.requested_by) {
      const highCount = findings.filter((f) => ["critical", "high"].includes(f.severity)).length;
      await enqueueNotification({
        userId: review.requested_by,
        type: highCount > 0 ? "alert" : "success",
        title: "Review completed",
        body: `${projectName} ${reviewLabel} — ${findings.length} finding(s)${highCount ? `, ${highCount} high severity` : ""}.`,
        link: `/code-review/${review.project_id}`,
        preferenceKey: "push_review_complete",
      });
    }
  } catch (error) {
    console.error("Review job failed:", error);
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

function parseFindings(text: string, diff?: string): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");

  // Extract file paths mentioned in the diff for context
  const diffFiles = diff
    ? [...diff.matchAll(/^=== (.+?) ===/gm)].map((m) => m[1])
    : [];

  const sevMap: Record<string, Finding["severity"]> = {
    "🔴": "critical", critical: "critical",
    "🟠": "high",     high: "high",
    "🟡": "medium",   medium: "medium",
    "🟢": "low",      low: "low",
    "🔵": "info",     info: "info",
  };

  let currentFinding: Partial<Finding> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Match numbered finding lines like: "1. 🔴 **Critical** — some issue"
    const findingMatch = line.match(/^\d+\.\s*(🔴|🟠|🟡|🟢|🔵)?\s*\*?\*?(critical|high|medium|low|info)\*?\*?[:\s—-]+(.+)/i);
    if (findingMatch) {
      if (currentFinding?.title) findings.push(completeFinding(currentFinding, diffFiles));
      const sevKey = findingMatch[1] ?? findingMatch[2].toLowerCase();
      currentFinding = {
        severity: sevMap[sevKey] ?? "medium",
        title: findingMatch[3].replace(/\*\*/g, "").trim(),
        file_path: "",
        suggestion: "",
      };
      continue;
    }

    // Match file path mentions like "File: src/foo.ts:12"
    if (currentFinding) {
      const fileMatch = line.match(/(?:file|path|location)[:\s]+([^\s:]+\.[a-z]+)(?::(\d+))?/i);
      if (fileMatch) {
        currentFinding.file_path = fileMatch[1];
        if (fileMatch[2]) currentFinding.line = parseInt(fileMatch[2]);
        continue;
      }

      // Suggestion / fix / recommendation lines
      if (/^(?:fix|suggestion|recommendation|solution)[:\s]/i.test(line)) {
        currentFinding.suggestion = line.replace(/^(?:fix|suggestion|recommendation|solution)[:\s]/i, "").trim();
        continue;
      }

      // Inline code reference like "`src/foo.ts`"
      if (!currentFinding.file_path) {
        const inlineFile = line.match(/`([^`]+\.[a-z]+)`/);
        if (inlineFile) currentFinding.file_path = inlineFile[1];
      }

      // Append to suggestion if it looks like explanation text
      if (line && !line.startsWith("#") && !line.startsWith("*") && currentFinding.suggestion === "") {
        currentFinding.suggestion = line;
      }
    }
  }

  if (currentFinding?.title) findings.push(completeFinding(currentFinding, diffFiles));

  // If nothing parsed, create one generic finding from the summary
  if (findings.length === 0 && text.length > 100) {
    findings.push({
      file_path: diffFiles[0] ?? "unknown",
      severity: "medium",
      title: "Review completed — see summary for details",
      suggestion: text.slice(0, 500),
    });
  }

  return findings;
}

function completeFinding(f: Partial<Finding>, diffFiles: string[]): Finding {
  return {
    file_path: f.file_path || diffFiles[0] || "unknown",
    line: f.line,
    severity: f.severity ?? "medium",
    title: f.title ?? "Issue found",
    suggestion: f.suggestion || f.title || "",
  };
}
