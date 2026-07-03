import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireWorkspace } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { chatModel } from "../config/ai.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";

const r = Router();
r.use(requireAuth, requireWorkspace);

const SYSTEM_PROMPTS: Record<string, string> = {
  "code-review": `You are a senior software engineer performing a thorough code review.
When given code, identify: bugs, logic errors, edge cases missed, anti-patterns, naming issues, unnecessary complexity, and missing error handling.
For each issue give: the line reference, severity (critical/high/medium/low), description, and a concrete fix.
Be direct and actionable. Format findings as a numbered list.`,

  "code-quality": `You are a code quality and software architecture expert.
Analyze code for: maintainability, cyclomatic complexity, coupling/cohesion, SOLID principle violations, DRY violations, test coverage gaps, magic numbers/strings, and documentation quality.
Suggest concrete refactors with before/after examples where helpful.
Rate overall quality 0-100 and explain the score.`,

  security: `You are an application security engineer specializing in secure code review.
Scan the provided code for vulnerabilities including OWASP Top 10:
- Injection (SQL, command, LDAP, XPath)
- Broken authentication / insecure session management
- Sensitive data exposure / hardcoded secrets
- XSS, CSRF, SSRF
- Insecure deserialization
- Broken access control
- Security misconfiguration
Rate each finding: critical / high / medium / low / informational.
Provide remediation steps and reference CVEs or CWEs where relevant.`,

  dev: `You are a DevOps and platform engineering expert.
You help with: Dockerfiles, GitHub Actions CI/CD pipelines, Kubernetes manifests, Helm charts, Terraform/Pulumi IaC, environment configuration, secrets management, observability (logs/metrics/traces), and deployment strategies (blue-green, canary, rolling).
When asked to generate a config, produce the full file with inline comments explaining non-obvious choices.
Always consider security, scalability, and cost.`,
};

r.post("/inline-chat", aiLimiter, async (req, res) => {
  const body = z.object({
    agentType: z.enum(["code-review", "code-quality", "security", "dev"]),
    message: z.string().min(1).max(8000),
    fileName: z.string().optional(),
    fileContent: z.string().max(100_000).optional(),
    history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() })).default([]),
  }).parse(req.body);

  openSse(res);

  const systemPrompt = SYSTEM_PROMPTS[body.agentType];
  const msgs: { role: string; content: string }[] = [{ role: "system", content: systemPrompt }];

  // Inject file context if provided
  if (body.fileContent && body.fileName) {
    msgs.push({
      role: "system",
      content: `Current file: ${body.fileName}\n\`\`\`\n${body.fileContent.slice(0, 80_000)}\n\`\`\``,
    });
  }

  // Inject conversation history
  for (const m of body.history) msgs.push(m);

  // Add user message
  msgs.push({ role: "user", content: body.message });

  let full = "";
  try {
    const stream = await chatModel.stream(msgs);
    for await (const chunk of stream) {
      if (chunk.content) {
        full += chunk.content;
        sseSend(res, "delta", { text: chunk.content });
      }
    }
  } catch (err) {
    console.error("Inline chat failed", err);
    sseSend(res, "error", { message: "AI request failed" });
  }

  sseSend(res, "done", { full });
  sseClose(res);
});

export default r;
