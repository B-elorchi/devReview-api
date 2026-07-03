import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages";
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

export type AgentType = "code-review" | "code-quality" | "security" | "dev";

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
- For targeted questions ("is there a bug on line 12?") — answer directly, only calling tools if needed.
- Keep responses clear and actionable. Use markdown formatting.`,

  "code-quality": `You are a software quality and architecture expert and friendly assistant.

Behaviour:
- For casual messages — respond conversationally without calling tools.
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
- When asked to analyse a file, check a Dockerfile, review CI/CD config, or audit IaC — use your tools:
    1. detect_cicd_patterns → understand the file's purpose
    2. analyze_dockerfile → if it looks like a Dockerfile
    3. analyze_code_structure → general stats
  Then provide: purpose explanation, issues/best practice violations, improved config snippets, security hardening tips.
- For general DevOps questions (Docker, Kubernetes, CI/CD, Terraform) — answer directly from knowledge.
- Use markdown. Provide concrete commands and config examples.`,
};

// ─── Agent tools per type ─────────────────────────────────────────────────────

const AGENT_TOOLS: Record<AgentType, any[]> = {
  "code-review": [analyzeCodeStructureTool, detectAntiPatternsTool, searchPatternsTool, extractFunctionsTool],
  "code-quality": [analyzeCodeStructureTool, measureComplexityTool, checkSolidPrinciplesTool, extractFunctionsTool],
  security:      [scanVulnerabilitiesTool, checkDependencyRisksTool, searchPatternsTool, analyzeCodeStructureTool],
  dev:           [detectCiCdPatternsTool, analyzeDockerfileTool, analyzeCodeStructureTool, searchPatternsTool],
};

// ─── Build and run agent, streaming chunks ────────────────────────────────────

export async function runAgent({
  agentType,
  message,
  fileName,
  fileContent,
  history,
  onChunk,
}: {
  agentType: AgentType;
  message: string;
  fileName?: string;
  fileContent?: string;
  history: { role: "user" | "assistant"; content: string }[];
  onChunk: (text: string) => void;
}): Promise<string> {
  const tools = AGENT_TOOLS[agentType];
  const systemPrompt = SYSTEM_PROMPTS[agentType];

  const agent = createReactAgent({ llm: chatModel, tools });

  // Build messages
  const messages: (HumanMessage | SystemMessage)[] = [];

  // System context
  let systemContent = systemPrompt;
  if (fileContent && fileName) {
    systemContent += `\n\nCurrent file: **${fileName}**\n\`\`\`\n${fileContent.slice(0, 80_000)}\n\`\`\``;
  }
  messages.push(new SystemMessage(systemContent));

  // Conversation history
  for (const h of history) {
    if (h.role === "user") messages.push(new HumanMessage(h.content));
  }

  // Current user message
  messages.push(new HumanMessage(message));

  let full = "";

  // streamMode "messages" emits [message, metadata] tuples.
  const stream = await agent.stream({ messages }, { streamMode: "messages" });

  for await (const item of stream) {
    const chunk = Array.isArray(item) ? item[0] : item;

    // Only forward AIMessage chunks that carry plain text (skip ToolMessage and tool_call chunks)
    if (!(chunk instanceof AIMessage)) continue;

    const hasToolCalls =
      Array.isArray((chunk as any).tool_calls) && (chunk as any).tool_calls.length > 0;
    if (hasToolCalls) continue;

    const text = typeof chunk.content === "string" ? chunk.content : "";
    if (text) {
      onChunk(text);
      full += text;
    }
  }

  return full;
}
