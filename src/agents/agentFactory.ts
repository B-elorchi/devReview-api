import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIMessage, AIMessageChunk, BaseMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
import { chatModel } from "../config/ai.js";
import {
  analyzeCodeStructureTool,
  searchPatternsTool,
  extractFunctionsTool,
  detectAntiPatternsTool,
  scanVulnerabilitiesTool,
  checkDependencyRisksTool,
  measureComplexityTool,
  checkSolidPrinciplesTool,
  analyzeDockerfileTool,
  detectCiCdPatternsTool,
} from "./tools.js";

export type AgentType = "code-review" | "code-quality" | "security" | "dev" | "platform-assistant";

// ─── System prompts — conversational + tool-augmented ─────────────────────────

const SYSTEM_PROMPTS: Record<AgentType, string> = {
  "code-review": `You are a senior software engineer and friendly code review assistant.

Behaviour:
- For casual messages ("hi", "hello", "what can you do") — respond conversationally without calling tools.
- When the user asks to review, analyse, check, or inspect code — use your tools:
    1. analyze_code_structure → understand scope
    2. detect_anti_patterns → find code smells
    3. extract_functions → examine individual functions
    4. search_patterns → dig deeper if needed
  Then reply with a numbered list of findings (line ref, severity 🔴🟠🟡🟢, issue, fix) and an overall score /100.
- When the user asks to ADD, UPDATE, EDIT, FIX, or MODIFY the file (e.g. "add a comment", "fix the bug", "refactor this") — return the COMPLETE updated file inside a SINGLE fenced code block with the correct language tag. Include EVERY line of the file, not just the changed part. Never return only a snippet.
- For targeted questions ("is there a bug on line 12?") — answer directly, only calling tools if needed.
- Keep responses clear and actionable. Use markdown formatting.`,

  "code-quality": `You are a software quality and architecture expert and friendly assistant.

Behaviour:
- For casual messages — respond conversationally without calling tools.
- When the user asks to ADD, UPDATE, EDIT, FIX, or MODIFY the file — return the COMPLETE updated file inside a SINGLE fenced code block with the correct language tag. Include EVERY line, never just a snippet.
- When asked to analyse quality, measure complexity, or review architecture — use your tools:
    1. analyze_code_structure → baseline metrics
    2. measure_complexity → identify hotspots
    3. check_solid_principles → SOLID/DRY violations
    4. extract_functions → function-level review
  Then produce: metrics summary, violations with refactor examples, quality score /100.
- For specific questions — answer directly and concisely.
- Use markdown. Keep a helpful, constructive tone.`,

  security: `You are an application security engineer and friendly assistant.

Behaviour:
- For casual messages — respond conversationally without calling tools.
- When the user asks to ADD, UPDATE, EDIT, FIX, or MODIFY the file — return the COMPLETE updated file inside a SINGLE fenced code block with the correct language tag. Include EVERY line, never just a snippet.
- When asked to scan, audit, check security, or find vulnerabilities — use your tools:
    1. scan_vulnerabilities → check for OWASP Top 10 issues (always run this first for security requests)
    2. check_dependency_risks → risky imports
    3. search_patterns → extra pattern checks if needed
  Then produce a security report: findings with CWE IDs, severity (🔴🟠🟡🔵), affected lines, remediation steps, score /100, and immediate action items.
- For targeted security questions — answer directly.
- Use markdown. Be precise about risks without unnecessary alarm.`,

  dev: `You are a DevOps, infrastructure, and platform engineering expert and friendly assistant.

Behaviour:
- For casual messages — respond conversationally without calling tools.
- When the user asks to ADD, UPDATE, EDIT, FIX, or MODIFY the file — return the COMPLETE updated file inside a SINGLE fenced code block with the correct language tag. Include EVERY line, never just a snippet.
- When asked to analyse a file, check a Dockerfile, review CI/CD config, or audit IaC — use your tools:
    1. detect_cicd_patterns → understand the file's purpose
    2. analyze_dockerfile → if it looks like a Dockerfile
    3. analyze_code_structure → general stats
  Then provide: purpose explanation, issues/best practice violations, improved config snippets, security hardening tips.
- For general DevOps questions (Docker, Kubernetes, CI/CD, Terraform) — answer directly from knowledge.
- Use markdown. Provide concrete commands and config examples.`,

  "platform-assistant": `You are the DevReview AI Platform Assistant — a full-access agent for the DevReview platform.

You can perform ANY action on the platform on behalf of the user via your tools:
- List, create, or delete projects
- Trigger AI code reviews and fetch results
- List, read, write files inside any project
- Push code to GitHub
- Show workspace statistics

Rules:
- When the user mentions a project by name, use list_projects first to confirm the correct project.
- When asked to write or edit code, use write_file with the COMPLETE file content.
- After triggering a review, tell the user it will take 30-60 seconds and they can ask for results.
- Before deleting anything, confirm with the user.
- Keep responses concise and use Markdown. Use emojis for clarity.
- If no workspace is linked, tell the user to link their Telegram account on the platform Settings → Integrations → Telegram page.`,
};

// ─── Agent tools per type ─────────────────────────────────────────────────────

const AGENT_TOOLS: Record<AgentType, any[]> = {
  "code-review": [analyzeCodeStructureTool, detectAntiPatternsTool, searchPatternsTool, extractFunctionsTool],
  "code-quality": [analyzeCodeStructureTool, measureComplexityTool, checkSolidPrinciplesTool, extractFunctionsTool],
  security:      [scanVulnerabilitiesTool, checkDependencyRisksTool, searchPatternsTool, analyzeCodeStructureTool],
  dev:           [detectCiCdPatternsTool, analyzeDockerfileTool, analyzeCodeStructureTool, searchPatternsTool],
  "platform-assistant": [], // Populated dynamically via setPlatformContext
};

// ─── Build and run agent, streaming chunks ────────────────────────────────────

export async function runAgent({
  agentType,
  message,
  fileName,
  fileContent,
  history,
  userId,
  onChunk,
}: {
  agentType: AgentType;
  message: string;
  fileName?: string;
  fileContent?: string;
  history: { role: "user" | "assistant"; content: string }[];
  userId?: string;
  onChunk: (text: string) => void;
}): Promise<{ fullText: string; tokensUsed: number }> {
  let tools = AGENT_TOOLS[agentType];

  if (agentType === "platform-assistant") {
    const { ALL_PLATFORM_TOOLS, setPlatformContext } = await import("./platformTools.js");
    // workspaceId is not in runAgent signature — caller must set context via setPlatformContext before calling
    tools = ALL_PLATFORM_TOOLS;
  }

  const systemPrompt = SYSTEM_PROMPTS[agentType];

  // Build system prompt
  let systemContent = systemPrompt;
  if (fileContent && fileName) {
    systemContent += `\n\nCurrent file: **${fileName}**\n\`\`\`\n${fileContent.slice(0, 80_000)}\n\`\`\``;
  }

  const agent = createReactAgent({ llm: chatModel, tools, stateModifier: systemContent });

  // Build conversation messages (no SystemMessage — passed via stateModifier above)
  const messages: (HumanMessage)[] = [];

  // Conversation history
  for (const h of history) {
    if (h.role === "user") messages.push(new HumanMessage(h.content));
  }

  // Current user message
  messages.push(new HumanMessage(message));

  // streamMode:"messages" emits 2-tuples: [BaseMessage|AIMessageChunk, metadata]
  let full = "";
  let tokensUsed = 0;

  const stream = await agent.stream({ messages }, { streamMode: "messages" });

  for await (const [chunk, _meta] of stream) {
    // Extract token metadata if present
    const chunkAny = chunk as any;
    if (chunkAny.usage_metadata?.total_tokens) {
      tokensUsed = Math.max(tokensUsed, chunkAny.usage_metadata.total_tokens);
    }

    // Accept AIMessageChunk (streaming tokens) and AIMessage (final node output)
    const isAI = chunk instanceof AIMessage || chunk instanceof AIMessageChunk;
    if (!isAI) continue;

    // Skip tool-call invocation chunks (contain function args, no text yet)
    if (Array.isArray((chunk as any).tool_calls) && (chunk as any).tool_calls.length > 0) continue;

    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (text) {
      onChunk(text);
      full += text;
    }
  }

  return { fullText: full, tokensUsed };
}
