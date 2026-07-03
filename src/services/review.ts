import { chatModel } from "../config/ai.js";
import { supabaseAdmin } from "../config/supabase.js";
import { z } from "zod";
import { StructuredOutputParser } from "@langchain/core/output_parsers";
import { PromptTemplate } from "@langchain/core/prompts";
import { RunnableSequence } from "@langchain/core/runnables";

// Define the expected output structure using Zod
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
  await supabaseAdmin.from("reviews").update({ status: "running" }).eq("id", input.reviewId);

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

    if (result.findings && result.findings.length > 0) {
      await supabaseAdmin.from("review_findings").insert(
        result.findings.map((f: any) => ({ review_id: input.reviewId, ...(f as object) }))
      );
    }
  } catch (error: any) {
    console.error("LangChain review failed:", error);
    await supabaseAdmin.from("reviews").update({
      status: "error",
      summary: "AI review failed to generate valid structured output.",
      completed_at: new Date().toISOString(),
    }).eq("id", input.reviewId);
  }
}
