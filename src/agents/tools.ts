import { tool } from "@langchain/core/tools";
import { z } from "zod";

// ─── Shared code-analysis tools ───────────────────────────────────────────────

export const analyzeCodeStructureTool = tool(
  async ({ code, language }) => {
    const lines     = code.split("\n");
    const functions = (code.match(/(?:function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(|=>\s*\{|class\s+\w+)/g) ?? []).length;
    const imports   = (code.match(/^(?:import|require|from)\s/gm) ?? []).length;
    const comments  = (code.match(/\/\/.*|\/\*[\s\S]*?\*\//g) ?? []).length;
    const todos     = (code.match(/TODO|FIXME|HACK|XXX/gi) ?? []).length;
    const maxLen    = Math.max(...lines.map((l) => l.length));

    return JSON.stringify({
      lineCount: lines.length,
      functionCount: functions,
      importCount: imports,
      commentCount: comments,
      todoCount: todos,
      maxLineLength: maxLen,
      language,
      complexity: functions > 20 ? "high" : functions > 10 ? "medium" : "low",
    });
  },
  {
    name: "analyze_code_structure",
    description: "Analyze the structure of source code: count lines, functions, imports, comments, TODOs, and estimate complexity.",
    schema: z.object({
      code:     z.string().describe("The source code to analyze"),
      language: z.string().describe("Programming language"),
    }),
  },
);

export const searchPatternsTool = tool(
  async ({ code, patterns }) => {
    const results: { pattern: string; matches: { line: number; text: string }[] }[] = [];
    const lines = code.split("\n");
    for (const pattern of patterns) {
      const re = new RegExp(pattern, "gi");
      const matches = lines
        .map((text, i) => ({ line: i + 1, text: text.trim() }))
        .filter(({ text }) => re.test(text));
      results.push({ pattern, matches: matches.slice(0, 10) });
    }
    return JSON.stringify(results);
  },
  {
    name: "search_patterns",
    description: "Search for specific regex patterns in code. Returns matching lines with line numbers.",
    schema: z.object({
      code:     z.string().describe("Source code to search"),
      patterns: z.array(z.string()).describe("List of regex patterns to search for"),
    }),
  },
);

export const extractFunctionsTool = tool(
  async ({ code }) => {
    const lines = code.split("\n");
    const fns: { name: string; line: number; snippet: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|class\s+(\w+))/);
      if (m) {
        const name = m[1] ?? m[2] ?? m[3] ?? "anonymous";
        fns.push({ name, line: i + 1, snippet: lines.slice(i, i + 3).join("\n") });
      }
    }
    return JSON.stringify(fns.slice(0, 30));
  },
  {
    name: "extract_functions",
    description: "Extract all function, method, and class definitions from code with their line numbers.",
    schema: z.object({ code: z.string().describe("Source code") }),
  },
);

// ─── Code-review tools ────────────────────────────────────────────────────────

export const detectAntiPatternsTool = tool(
  async ({ code, language }) => {
    const antiPatterns: { name: string; pattern: string; severity: string }[] = [];

    if (["typescript", "javascript"].includes(language)) {
      antiPatterns.push(
        { name: "any type",              pattern: ": any",                severity: "medium" },
        { name: "console.log",           pattern: "console\\.log",        severity: "low" },
        { name: "== instead of ===",     pattern: "[^=!]==[^=]",          severity: "medium" },
        { name: "var declaration",       pattern: "\\bvar\\b",            severity: "low" },
        { name: "callback hell",         pattern: "\\(err,",              severity: "medium" },
        { name: "magic number",          pattern: "[^\\w][0-9]{3,}[^\\w]",severity: "low" },
        { name: "empty catch block",     pattern: "catch\\s*\\(.*\\)\\s*\\{\\s*\\}", severity: "high" },
        { name: "hardcoded credential",  pattern: "password\\s*=\\s*['\"]", severity: "critical" },
      );
    } else if (language === "python") {
      antiPatterns.push(
        { name: "bare except",           pattern: "except\\s*:",          severity: "medium" },
        { name: "print statement",       pattern: "\\bprint\\(",          severity: "low" },
        { name: "hardcoded credential",  pattern: "password\\s*=\\s*['\"]", severity: "critical" },
        { name: "mutable default arg",   pattern: "def .*=\\s*\\[",       severity: "high" },
      );
    }

    const lines = code.split("\n");
    const found: { antiPattern: string; severity: string; line: number; text: string }[] = [];

    for (const ap of antiPatterns) {
      const re = new RegExp(ap.pattern, "gi");
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          found.push({ antiPattern: ap.name, severity: ap.severity, line: i + 1, text: lines[i].trim() });
        }
      }
    }
    return JSON.stringify(found);
  },
  {
    name: "detect_anti_patterns",
    description: "Detect common anti-patterns and code smells in source code.",
    schema: z.object({
      code:     z.string().describe("Source code"),
      language: z.string().describe("Programming language"),
    }),
  },
);

// ─── Security tools ───────────────────────────────────────────────────────────

export const scanVulnerabilitiesTool = tool(
  async ({ code, language }) => {
    const vulnPatterns = [
      // Injection
      { id: "SQL-INJ",   cwe: "CWE-89",  severity: "critical", name: "SQL Injection",          pattern: /db\.(query|execute|raw)\s*\(`[^`]*\$\{/gi },
      { id: "CMD-INJ",   cwe: "CWE-78",  severity: "critical", name: "Command Injection",       pattern: /exec\s*\([^)]*\+|execSync\s*\([^)]*\+/gi },
      { id: "XSS",       cwe: "CWE-79",  severity: "high",     name: "Reflected XSS",           pattern: /innerHTML\s*=\s*[^"'`]|dangerouslySetInnerHTML/gi },
      // Secrets
      { id: "HARDCODED-SECRET", cwe: "CWE-798", severity: "critical", name: "Hardcoded Secret", pattern: /(?:password|secret|api_key|token)\s*[:=]\s*["'][^"']{6,}["']/gi },
      { id: "HARDCODED-TOKEN",  cwe: "CWE-798", severity: "critical", name: "Hardcoded Token",  pattern: /["'](?:sk-|ghp_|glpat-|xox[baprs]-)[A-Za-z0-9]{10,}["']/g },
      // Crypto
      { id: "WEAK-HASH", cwe: "CWE-327", severity: "high",     name: "Weak Hash (MD5/SHA1)",    pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']\)/gi },
      { id: "INSECURE-RANDOM", cwe: "CWE-338", severity: "medium", name: "Insecure Random",    pattern: /Math\.random\(\)/g },
      // Node.js specific
      { id: "EVAL",      cwe: "CWE-95",  severity: "critical", name: "eval() usage",            pattern: /\beval\s*\(/g },
      { id: "CHILD-PROC",cwe: "CWE-78",  severity: "high",     name: "Unsafe child_process",    pattern: /child_process|execSync|spawnSync/g },
      // Path traversal
      { id: "PATH-TRAV", cwe: "CWE-22",  severity: "high",     name: "Path Traversal Risk",     pattern: /readFile\s*\([^)]*req\.(params|query|body)/gi },
      // Open redirect
      { id: "OPEN-REDIR",cwe: "CWE-601", severity: "medium",   name: "Open Redirect",           pattern: /res\.redirect\s*\([^)]*req\.(params|query)/gi },
      // SSRF
      { id: "SSRF",      cwe: "CWE-918", severity: "high",     name: "SSRF Risk",               pattern: /fetch\s*\([^)]*req\.(params|query|body)/gi },
    ];

    const lines = code.split("\n");
    const found: any[] = [];

    for (const vp of vulnPatterns) {
      vp.pattern.lastIndex = 0;
      for (let i = 0; i < lines.length; i++) {
        if (vp.pattern.test(lines[i])) {
          found.push({
            id: vp.id, cwe: vp.cwe, severity: vp.severity,
            name: vp.name, line: i + 1, text: lines[i].trim(),
          });
          vp.pattern.lastIndex = 0;
        }
      }
    }

    return JSON.stringify({ vulnerabilities: found, totalFound: found.length });
  },
  {
    name: "scan_vulnerabilities",
    description: "Scan code for security vulnerabilities: SQL injection, XSS, hardcoded secrets, weak crypto, SSRF, command injection, path traversal, open redirect, and eval usage. Returns findings with CWE IDs and severity.",
    schema: z.object({
      code:     z.string().describe("Source code to scan"),
      language: z.string().describe("Programming language"),
    }),
  },
);

export const checkDependencyRisksTool = tool(
  async ({ code }) => {
    const riskyDeps: { name: string; risk: string; reason: string }[] = [];
    const depPatterns: { pattern: RegExp; name: string; risk: string; reason: string }[] = [
      { pattern: /require\s*\(\s*["']child_process["']\)/,  name: "child_process",   risk: "high",   reason: "Allows arbitrary command execution" },
      { pattern: /require\s*\(\s*["']fs["']\)/,             name: "fs",              risk: "medium", reason: "File system access — verify paths are sanitized" },
      { pattern: /require\s*\(\s*["']vm["']\)/,             name: "vm",              risk: "high",   reason: "JavaScript VM module — sandbox escape risk" },
      { pattern: /require\s*\(\s*["']eval["']\)/,           name: "eval",            risk: "critical", reason: "Dynamic code execution" },
      { pattern: /import.*from\s*["']node:child_process["']/, name: "child_process", risk: "high",   reason: "Allows arbitrary command execution" },
    ];

    for (const dp of depPatterns) {
      if (dp.pattern.test(code)) riskyDeps.push({ name: dp.name, risk: dp.risk, reason: dp.reason });
    }

    return JSON.stringify({ riskyDependencies: riskyDeps });
  },
  {
    name: "check_dependency_risks",
    description: "Check imported/required packages for known security risks.",
    schema: z.object({ code: z.string().describe("Source code") }),
  },
);

// ─── Code-quality tools ───────────────────────────────────────────────────────

export const measureComplexityTool = tool(
  async ({ code }) => {
    // Cyclomatic complexity approximation: count decision points
    const decisionKeywords = /\b(if|else if|while|for|switch|case|catch|&&|\|\||\?)\b/g;
    const decisions = (code.match(decisionKeywords) ?? []).length;
    const functions = (code.match(/(?:function\s+\w+|\w+\s*=\s*(?:async\s*)?\(|=>)/g) ?? []).length || 1;
    const avgComplexity = Math.round((decisions / functions) * 10) / 10;

    const lines = code.split("\n");
    const longFunctions: { approxLine: number; length: number }[] = [];
    let fnStart = -1;
    let depth = 0;
    for (let i = 0; i < lines.length; i++) {
      const opens = (lines[i].match(/\{/g) ?? []).length;
      const closes = (lines[i].match(/\}/g) ?? []).length;
      if (opens > 0 && depth === 0) { fnStart = i; }
      depth += opens - closes;
      if (depth <= 0 && fnStart >= 0) {
        const len = i - fnStart;
        if (len > 30) longFunctions.push({ approxLine: fnStart + 1, length: len });
        fnStart = -1;
        depth = 0;
      }
    }

    return JSON.stringify({
      estimatedCyclomaticComplexity: decisions + 1,
      decisionPoints: decisions,
      functionCount: functions,
      avgComplexityPerFunction: avgComplexity,
      longFunctions,
      recommendation: avgComplexity > 10
        ? "High complexity — consider breaking into smaller functions"
        : avgComplexity > 5
        ? "Moderate complexity — consider refactoring decision-heavy sections"
        : "Complexity is acceptable",
    });
  },
  {
    name: "measure_complexity",
    description: "Measure cyclomatic complexity and identify overly long or complex functions.",
    schema: z.object({ code: z.string().describe("Source code") }),
  },
);

export const checkSolidPrinciplesTool = tool(
  async ({ code, language }) => {
    const issues: { principle: string; issue: string; suggestion: string }[] = [];
    const lines = code.split("\n");
    const lineCount = lines.length;

    // Single Responsibility: file too large
    if (lineCount > 300) {
      issues.push({
        principle: "Single Responsibility (SRP)",
        issue: `File has ${lineCount} lines — likely handles too many concerns`,
        suggestion: "Split into smaller modules, each with a single responsibility",
      });
    }

    // Open/Closed: switch on type (OCP violation)
    const switchTypeMatches = code.match(/switch\s*\([^)]*type[^)]*\)/gi) ?? [];
    if (switchTypeMatches.length > 0) {
      issues.push({
        principle: "Open/Closed (OCP)",
        issue: "Switch on 'type' detected — adding new types requires modifying this file",
        suggestion: "Use polymorphism or a strategy/factory pattern instead",
      });
    }

    // DRY: repeated blocks (simple heuristic)
    const dupCheck: Record<string, number> = {};
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 20) dupCheck[t] = (dupCheck[t] ?? 0) + 1;
    }
    const dupes = Object.entries(dupCheck).filter(([, c]) => c > 2);
    if (dupes.length > 0) {
      issues.push({
        principle: "DRY (Don't Repeat Yourself)",
        issue: `${dupes.length} lines repeated 3+ times`,
        suggestion: "Extract repeated logic into a shared utility or hook",
      });
    }

    // Interface Segregation: large parameter objects
    const bigParams = code.match(/\([^)]{200,}\)/g) ?? [];
    if (bigParams.length > 0) {
      issues.push({
        principle: "Interface Segregation (ISP)",
        issue: "Very large parameter list detected",
        suggestion: "Consider breaking into smaller, focused interfaces or using an options object",
      });
    }

    return JSON.stringify({ violations: issues, score: Math.max(0, 100 - issues.length * 15) });
  },
  {
    name: "check_solid_principles",
    description: "Check code against SOLID principles and DRY. Returns violations with suggestions.",
    schema: z.object({
      code:     z.string().describe("Source code"),
      language: z.string().describe("Programming language"),
    }),
  },
);

// ─── DevOps tools ─────────────────────────────────────────────────────────────

export const analyzeDockerfileTool = tool(
  async ({ content }) => {
    const issues: { severity: string; issue: string; line: number; fix: string }[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].trim();
      if (/^FROM\s+\w+\s*$/i.test(l) && !l.includes(":")) {
        issues.push({ severity: "high", line: i+1, issue: "No image tag specified — will use 'latest'", fix: "Pin to a specific version e.g. node:20-alpine" });
      }
      if (/^FROM\s+.*:latest/i.test(l)) {
        issues.push({ severity: "medium", line: i+1, issue: "Using :latest tag is non-deterministic", fix: "Pin to a specific version tag" });
      }
      if (/^RUN\s+apt-get\s+install/i.test(l) && !content.includes("apt-get clean")) {
        issues.push({ severity: "low", line: i+1, issue: "apt-get install without cache cleanup bloats image", fix: "Add && rm -rf /var/lib/apt/lists/* after apt-get install" });
      }
      if (/COPY\s+\.\s+\./i.test(l) && !content.includes(".dockerignore")) {
        issues.push({ severity: "medium", line: i+1, issue: "Copying all files without .dockerignore may include secrets/node_modules", fix: "Create a .dockerignore file" });
      }
      if (/^USER\s+root/i.test(l)) {
        issues.push({ severity: "high", line: i+1, issue: "Running as root is a security risk", fix: "Create a non-root user: RUN adduser -D appuser && USER appuser" });
      }
    }

    const hasHealthCheck = /HEALTHCHECK/i.test(content);
    const hasUser = /^USER\s+(?!root)/im.test(content);
    const hasMultiStage = (content.match(/^FROM\s/gim) ?? []).length > 1;

    return JSON.stringify({
      issues,
      hasHealthCheck,
      hasNonRootUser: hasUser,
      isMultiStage: hasMultiStage,
      score: Math.max(0, 100 - issues.filter(i => i.severity === "high").length * 20 - issues.filter(i => i.severity === "medium").length * 10),
    });
  },
  {
    name: "analyze_dockerfile",
    description: "Analyze a Dockerfile for best practices: image tagging, cache layers, security, multi-stage builds.",
    schema: z.object({ content: z.string().describe("Dockerfile content") }),
  },
);

export const detectCiCdPatternsTool = tool(
  async ({ code, fileName }) => {
    const patterns: string[] = [];
    if (/github\.com|actions\//i.test(code)) patterns.push("GitHub Actions");
    if (/gitlab-ci|\.gitlab-ci/i.test(code)) patterns.push("GitLab CI");
    if (/jenkinsfile|pipeline\s*\{/i.test(code)) patterns.push("Jenkins");
    if (/circle\.yml|circleci/i.test(code)) patterns.push("CircleCI");
    if (/docker-compose/i.test(code)) patterns.push("Docker Compose");
    if (/kubernetes|kubectl|k8s/i.test(code)) patterns.push("Kubernetes");
    if (/terraform|\.tf/i.test(code)) patterns.push("Terraform");
    if (/helm\s|chart\.yaml/i.test(code)) patterns.push("Helm");

    const hasSecrets  = /\$\{\{.*secrets\./i.test(code);
    const hasCaching  = /cache:/i.test(code);
    const hasTests    = /test|pytest|jest|vitest/i.test(code);
    const hasArtifacts= /artifact|upload/i.test(code);

    return JSON.stringify({ detectedPatterns: patterns, hasSecretManagement: hasSecrets, hasCaching, hasTests, hasArtifacts, fileName });
  },
  {
    name: "detect_cicd_patterns",
    description: "Detect CI/CD, container, and IaC patterns in a file.",
    schema: z.object({
      code:     z.string().describe("File content"),
      fileName: z.string().describe("File name"),
    }),
  },
);
