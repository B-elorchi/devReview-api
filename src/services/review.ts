import { chatModel } from "../config/ai.js";
import { supabaseAdmin } from "../config/supabase.js";
import { z } from "zod";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";
import { enqueueNotification } from "./notifications.js";

const reviewOutputSchema = z.object({
  summary: z.string().describe("High level summary of the code review"),
  findings: z.array(
    z.object({
      file_path: z.string().describe("The file path where the issue was found"),
      line_number: z.number().describe("The line number of the issue"),
      severity: z.enum(["critical", "high", "medium", "low", "info"]).describe("Severity level"),
      message: z.string().describe("Short title or message describing the issue"),
      suggestion: z.string().describe("Detailed suggestion on how to fix it"),
    })
  ).describe("Array of code review findings"),
});

const parser = StructuredOutputParser.fromZodSchema(reviewOutputSchema);

const promptTemplate = PromptTemplate.fromTemplate(
  `You are an expert senior code reviewer. Review the provided code diff or snippet.
Identify bugs, security vulnerabilities, performance issues, and code smells.

{format_instructions}

Code to review:
{diff}`
);

export async function runReviewJob(input: { reviewId: string; diff?: string }) {
  const { data: review, error: reviewError } = await supabaseAdmin
    .from("reviews")
    .select("id, requested_by, ref, pr_number, projects(name)")
    .eq("id", input.reviewId)
    .maybeSingle();
  if (reviewError) throw reviewError;

  await supabaseAdmin.from("reviews").update({ status: "running" }).eq("id", input.reviewId);

  const projectName = (review as any)?.projects?.name ?? "project";
  const reviewLabel = review?.pr_number ? `PR #${review.pr_number}` : review?.ref ?? "HEAD";

  const chain = RunnableSequence.from([
    promptTemplate,
    chatModel,
    parser,
  ]);

  try {
    const result = await chain.invoke({
      diff: input.diff ?? "No diff provided.",
      format_instructions: parser.getFormatInstructions(),
    });

    await supabaseAdmin.from("reviews").update({
      status: "completed",
      summary: result.summary,
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);

    if (result.findings.length > 0) {
      const { error: findingsError } = await supabaseAdmin.from("review_findings").insert(
        result.findings.map((finding) => ({
          review_id: input.reviewId,
          file_path: finding.file_path,
          line: finding.line_number,
          line_start: finding.line_number,
          severity: finding.severity,
          title: finding.message,
          message: finding.message,
          suggestion: finding.suggestion,
        }))
      );
      if (findingsError) throw findingsError;
    }

    if (review?.requested_by) {
      const highSeverityCount = result.findings.filter((finding) => ["critical", "high"].includes(finding.severity)).length;
      await enqueueNotification({
        userId: review.requested_by,
        type: highSeverityCount > 0 ? "alert" : "success",
        title: "Review completed",
        body: `${projectName} ${reviewLabel} finished with ${result.findings.length} findings${highSeverityCount ? `, including ${highSeverityCount} high severity issues` : ""}.`,
        link: "/code-review",
        preferenceKey: "push_review_complete",
      });
    }
  } catch (error) {
    console.error("LangChain review failed:", error);
    await supabaseAdmin.from("reviews").update({
      status: "failed",
      summary: "AI review failed to generate valid structured output.",
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);

    if (review?.requested_by) {
      await enqueueNotification({
        userId: review.requested_by,
        type: "alert",
        title: "Review failed",
        body: `${projectName} ${reviewLabel} could not be completed.`,
        link: "/code-review",
        preferenceKey: "push_review_complete",
      });
    }
  }
}