import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { runReviewJob } from "../services/review.js";

// Context injected per-request so tools know which user/workspace to act on
let _userId: string | undefined;
let _workspaceId: string | undefined;

export function setPlatformContext(userId?: string, workspaceId?: string) {
  _userId      = userId;
  _workspaceId = workspaceId;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const listProjectsTool = tool(
  async () => {
    if (!_workspaceId) return "No workspace linked. Ask the user to link their Telegram account first.";
    const { data, error } = await supabaseAdmin
      .from("projects")
      .select("id, name, repo_url, default_branch, health_score, updated_at")
      .eq("workspace_id", _workspaceId)
      .order("updated_at", { ascending: false });
    if (error) return `Error: ${error.message}`;
    if (!data?.length) return "No projects found in this workspace.";
    return data.map((p, i) =>
      `${i + 1}. *${p.name}* (id: \`${p.id}\`)\n   Repo: ${p.repo_url ?? "no repo"} | Branch: ${p.default_branch ?? "main"} | Score: ${p.health_score ?? "unreviewed"}`
    ).join("\n\n");
  },
  {
    name: "list_projects",
    description: "List all projects in the user's workspace. Use this when the user asks 'what are my projects', 'show projects', 'list projects', etc.",
    schema: z.object({}),
  }
);

export const getProjectTool = tool(
  async ({ project_name_or_id }: { project_name_or_id: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data } = await supabaseAdmin
      .from("projects")
      .select("*, reviews(id, status, score, created_at)")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!data) return `Project "${project_name_or_id}" not found.`;
    const reviews = (data.reviews as any[]) ?? [];
    const lastReview = reviews[0];
    return [
      `*${data.name}*`,
      `ID: \`${data.id}\``,
      `Repo: ${data.repo_url ?? "none"}`,
      `Branch: ${data.default_branch ?? "main"}`,
      `Health: ${data.health_score ?? "unreviewed"}/100`,
      `Description: ${data.description ?? "—"}`,
      lastReview
        ? `Last review: ${lastReview.status} | Score: ${lastReview.score ?? "—"} | ${new Date(lastReview.created_at).toLocaleDateString()}`
        : "No reviews yet.",
    ].join("\n");
  },
  {
    name: "get_project",
    description: "Get details about a specific project by name or ID.",
    schema: z.object({ project_name_or_id: z.string().describe("Project name or UUID") }),
  }
);

export const createProjectTool = tool(
  async ({ name, repo_url, description }: { name: string; repo_url?: string; description?: string }) => {
    if (!_workspaceId || !_userId) return "No workspace linked. Link your Telegram account first.";
    const { data, error } = await supabaseAdmin
      .from("projects")
      .insert({ name, repo_url, description, workspace_id: _workspaceId, created_by: _userId, default_branch: "main" })
      .select()
      .single();
    if (error) return `Failed to create project: ${error.message}`;
    return `✅ Project *${data.name}* created!\nID: \`${data.id}\`\n${repo_url ? `Repo: ${repo_url}` : "No repo linked yet."}`;
  },
  {
    name: "create_project",
    description: "Create a new project in the workspace. Use when user says 'create project', 'new project', 'add project'.",
    schema: z.object({
      name:        z.string().describe("Project name"),
      repo_url:    z.string().url().optional().describe("GitHub repo URL (optional)"),
      description: z.string().optional().describe("Short project description"),
    }),
  }
);

export const deleteProjectTool = tool(
  async ({ project_name_or_id }: { project_name_or_id: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!data) return `Project "${project_name_or_id}" not found.`;
    await supabaseAdmin.from("projects").delete().eq("id", data.id);
    return `🗑️ Project *${data.name}* deleted.`;
  },
  {
    name: "delete_project",
    description: "Delete a project by name or ID. Ask the user to confirm before calling this.",
    schema: z.object({ project_name_or_id: z.string() }),
  }
);

// ─── Code Review ──────────────────────────────────────────────────────────────

export const triggerReviewTool = tool(
  async ({ project_name_or_id }: { project_name_or_id: string }) => {
    if (!_workspaceId || !_userId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project "${project_name_or_id}" not found. Use list_projects to see available projects.`;

    const { data: review, error } = await supabaseAdmin
      .from("reviews")
      .insert({ project_id: project.id, status: "queued", requested_by: _userId, ref: "HEAD" })
      .select()
      .single();
    if (error) return `Failed to queue review: ${error.message}`;

    // Run async
    runReviewJob({ reviewId: review.id }).catch((e) => console.error("Review job error", e));

    return `🔍 Review started for *${project.name}*!\n\nThis usually takes 30-60 seconds. I'll process the code using AI and you can check results on the platform or ask me "show review results for ${project.name}" when done.`;
  },
  {
    name: "trigger_review",
    description: "Trigger an AI code review for a project. Use when user says 'review project X', 'run review on X', 'check code for X'.",
    schema: z.object({ project_name_or_id: z.string().describe("Project name or ID to review") }),
  }
);

export const getReviewResultsTool = tool(
  async ({ project_name_or_id }: { project_name_or_id: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project "${project_name_or_id}" not found.`;

    const { data: review } = await supabaseAdmin
      .from("reviews")
      .select("*, review_findings(*)")
      .eq("project_id", project.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!review) return `No reviews found for *${project.name}*. Run a review first with /review ${project.name}`;
    if (review.status === "running" || review.status === "queued") return `⏳ Review for *${project.name}* is still ${review.status}. Check back in a moment.`;

    const findings: any[] = review.review_findings ?? [];
    const crit = findings.filter((f) => f.severity === "critical").length;
    const high = findings.filter((f) => f.severity === "high").length;
    const med  = findings.filter((f) => f.severity === "medium").length;
    const low  = findings.filter((f) => f.severity === "low").length;

    const lines = [
      `📊 *Review Results — ${project.name}*`,
      `Score: *${review.score ?? "—"}/100*`,
      `Status: ${review.status}`,
      ``,
      `🔴 Critical: ${crit}  🟠 High: ${high}  🟡 Medium: ${med}  🟢 Low: ${low}`,
      ``,
    ];

    const topFindings = findings.filter((f) => ["critical", "high"].includes(f.severity)).slice(0, 5);
    if (topFindings.length) {
      lines.push("*Top Issues:*");
      topFindings.forEach((f, i) => {
        lines.push(`${i + 1}. [${f.severity.toUpperCase()}] ${f.title}`);
        if (f.file_path) lines.push(`   📁 ${f.file_path}${f.line ? `:${f.line}` : ""}`);
        if (f.suggestion) lines.push(`   💡 ${f.suggestion.slice(0, 120)}`);
      });
    }

    if (review.summary) {
      lines.push("", "*Summary:*", review.summary.slice(0, 400));
    }

    return lines.join("\n");
  },
  {
    name: "get_review_results",
    description: "Get the latest review results for a project including findings, score and issues.",
    schema: z.object({ project_name_or_id: z.string() }),
  }
);

// ─── Files ────────────────────────────────────────────────────────────────────

export const listFilesTool = tool(
  async ({ project_name_or_id }: { project_name_or_id: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name, repo_url")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project "${project_name_or_id}" not found.`;

    // Get files from editor sandbox
    const { data: sandbox } = await supabaseAdmin
      .from("editor_sandboxes")
      .select("id")
      .eq("project_id", project.id)
      .limit(1)
      .maybeSingle();

    if (!sandbox) return `No editor files found for *${project.name}*. Files are available after opening the project in the Editor.`;

    const { data: files } = await supabaseAdmin
      .from("editor_files")
      .select("path, size, updated_at")
      .eq("sandbox_id", sandbox.id)
      .order("path");

    if (!files?.length) return `No files found for *${project.name}*.`;
    return `📁 *Files in ${project.name}:*\n\n` + files.map((f) => `• \`${f.path}\` (${f.size ?? 0} bytes)`).join("\n");
  },
  {
    name: "list_files",
    description: "List files in a project. Use when user asks 'show files for X', 'what files does X have'.",
    schema: z.object({ project_name_or_id: z.string() }),
  }
);

export const readFileTool = tool(
  async ({ project_name_or_id, file_path }: { project_name_or_id: string; file_path: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project not found.`;

    const { data: sandbox } = await supabaseAdmin
      .from("editor_sandboxes")
      .select("id")
      .eq("project_id", project.id)
      .limit(1)
      .maybeSingle();
    if (!sandbox) return "No editor files available for this project.";

    const { data: file } = await supabaseAdmin
      .from("editor_files")
      .select("content, path")
      .eq("sandbox_id", sandbox.id)
      .eq("path", file_path)
      .maybeSingle();

    if (!file) return `File \`${file_path}\` not found in ${project.name}.`;
    return `📄 *${file.path}*\n\`\`\`\n${(file.content ?? "").slice(0, 3000)}\n\`\`\``;
  },
  {
    name: "read_file",
    description: "Read the content of a specific file in a project.",
    schema: z.object({
      project_name_or_id: z.string(),
      file_path:          z.string().describe("Relative file path, e.g. src/index.ts"),
    }),
  }
);

export const writeFileTool = tool(
  async ({ project_name_or_id, file_path, content }: { project_name_or_id: string; file_path: string; content: string }) => {
    if (!_workspaceId || !_userId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project not found.`;

    let { data: sandbox } = await supabaseAdmin
      .from("editor_sandboxes")
      .select("id")
      .eq("project_id", project.id)
      .limit(1)
      .maybeSingle();

    if (!sandbox) {
      const { data: newSandbox } = await supabaseAdmin
        .from("editor_sandboxes")
        .insert({ owner_id: _userId, project_id: project.id, template: "custom", status: "ready" })
        .select()
        .single();
      sandbox = newSandbox;
    }
    if (!sandbox) return "Could not create file storage.";

    await supabaseAdmin
      .from("editor_files")
      .upsert({ sandbox_id: sandbox.id, path: file_path, content, type: "file", size: content.length, updated_at: new Date().toISOString() });

    return `✅ File \`${file_path}\` saved in *${project.name}*.\n${content.split("\n").length} lines written.`;
  },
  {
    name: "write_file",
    description: "Create or update a file in a project. Use when user says 'create file X', 'write code to X', 'update X with this code'.",
    schema: z.object({
      project_name_or_id: z.string(),
      file_path:          z.string().describe("Relative path like src/index.ts"),
      content:            z.string().describe("Full file content to write"),
    }),
  }
);

export const pushToGitHubTool = tool(
  async ({ project_name_or_id, message }: { project_name_or_id: string; message: string }) => {
    if (!_workspaceId) return "No workspace linked.";
    const { data: project } = await supabaseAdmin
      .from("projects")
      .select("id, name, repo_url")
      .eq("workspace_id", _workspaceId)
      .or(`name.ilike.%${project_name_or_id}%,id.eq.${project_name_or_id}`)
      .limit(1)
      .maybeSingle();
    if (!project) return `Project not found.`;
    if (!project.repo_url) return `Project *${project.name}* has no GitHub repo linked. Add one via the platform.`;

    const { data: sandbox } = await supabaseAdmin
      .from("editor_sandboxes")
      .select("id")
      .eq("project_id", project.id)
      .limit(1)
      .maybeSingle();
    if (!sandbox) return "No files to push. Write some files first.";

    const { data: files } = await supabaseAdmin
      .from("editor_files")
      .select("path, content")
      .eq("sandbox_id", sandbox.id);
    if (!files?.length) return "No files to push.";

    // Call the push endpoint logic directly
    const { env } = await import("../config/env.js");
    if (!env.GITHUB_TOKEN) return "GitHub token not configured on the server.";

    const fullName = (() => {
      try {
        const u = new URL(project.repo_url);
        const parts = u.pathname.replace(/^\//, "").replace(/\.git$/, "").split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
      } catch { return null; }
    })();
    if (!fullName) return "Invalid GitHub repo URL.";

    const pushed: string[] = [];
    const failed: string[] = [];

    for (const file of files.filter((f) => f.content)) {
      try {
        let sha: string | undefined;
        const existing = await fetch(`https://api.github.com/repos/${fullName}/contents/${file.path}`, {
          headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json" },
        });
        if (existing.ok) { const ed: any = await existing.json(); sha = ed.sha; }

        const res = await fetch(`https://api.github.com/repos/${fullName}/contents/${file.path}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" },
          body: JSON.stringify({ message, content: Buffer.from(file.content).toString("base64"), sha }),
        });
        if (res.ok) pushed.push(file.path);
        else failed.push(file.path);
      } catch { failed.push(file.path); }
    }

    const lines = [`🚀 *Push to ${fullName}*`, `Commit: "${message}"`, ""];
    if (pushed.length) lines.push(`✅ Pushed ${pushed.length} file(s):\n${pushed.map((p) => `  • ${p}`).join("\n")}`);
    if (failed.length) lines.push(`❌ Failed ${failed.length}:\n${failed.map((p) => `  • ${p}`).join("\n")}`);
    return lines.join("\n");
  },
  {
    name: "push_to_github",
    description: "Push editor files to GitHub. Use when user says 'push to GitHub', 'commit and push', 'deploy code'.",
    schema: z.object({
      project_name_or_id: z.string(),
      message:            z.string().describe("Commit message"),
    }),
  }
);

// ─── Workspace stats ──────────────────────────────────────────────────────────

export const workspaceStatsTool = tool(
  async () => {
    if (!_workspaceId) return "No workspace linked.";
    const [{ count: projectCount }, { count: reviewCount }, { data: ws }] = await Promise.all([
      supabaseAdmin.from("projects").select("id", { count: "exact", head: true }).eq("workspace_id", _workspaceId),
      supabaseAdmin.from("reviews").select("id", { count: "exact", head: true })
        .in("project_id", (await supabaseAdmin.from("projects").select("id").eq("workspace_id", _workspaceId)).data?.map((p) => p.id) ?? []),
      supabaseAdmin.from("workspaces").select("name, plan").eq("id", _workspaceId).maybeSingle(),
    ]);
    return [
      `📊 *Workspace: ${ws?.name ?? "Unknown"}*`,
      `Plan: ${ws?.plan ?? "free"}`,
      `Projects: ${projectCount ?? 0}`,
      `Total reviews: ${reviewCount ?? 0}`,
    ].join("\n");
  },
  {
    name: "workspace_stats",
    description: "Show workspace statistics — project count, review count, plan.",
    schema: z.object({}),
  }
);

// ─── GitHub repo creation ─────────────────────────────────────────────────────

export const createGithubRepoTool = tool(
  async ({ name, description, is_private }: { name: string; description?: string; is_private?: boolean }) => {
    const { env } = await import("../config/env.js");
    if (!env.GITHUB_TOKEN) return "GitHub token not configured on the server — cannot create repos.";
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/(^-|-$)/g, "");
    const resp = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: slug,
        description: description ?? "",
        private: is_private ?? false,
        auto_init: true,
      }),
    });
    const data: any = await resp.json();
    if (!resp.ok) return `Failed to create GitHub repo: ${data.message ?? resp.status}${data.errors ? " — " + JSON.stringify(data.errors) : ""}`;
    return `✅ GitHub repo created: ${data.html_url}\nClone: ${data.clone_url}\nDefault branch: ${data.default_branch}`;
  },
  {
    name: "create_github_repo",
    description: "Create a real GitHub repository via the GitHub API. Use when the user asks to create a repo on GitHub. Returns the actual repo URL — NEVER invent a GitHub URL yourself.",
    schema: z.object({
      name:        z.string().describe("Repository name (will be slugified)"),
      description: z.string().optional().describe("Repo description"),
      is_private:  z.boolean().optional().describe("Create as private repo (default false)"),
    }),
  }
);

export const ALL_PLATFORM_TOOLS = [
  createGithubRepoTool,
  listProjectsTool,
  getProjectTool,
  createProjectTool,
  deleteProjectTool,
  triggerReviewTool,
  getReviewResultsTool,
  listFilesTool,
  readFileTool,
  writeFileTool,
  pushToGitHubTool,
  workspaceStatsTool,
];
