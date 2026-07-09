import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { supabaseAdmin } from "../config/supabase.js";
import { runReviewJob } from "../services/review.js";

export function getPlatformTools(userId: string) {
  const listProjectsTool = tool(
    async () => {
      const { data: members } = await supabaseAdmin.from("workspace_members").select("workspace_id").eq("user_id", userId);
      if (!members || members.length === 0) return "You are not a member of any workspaces.";
      const workspaceIds = members.map(m => m.workspace_id);
      
      const { data: projects, error } = await supabaseAdmin.from("projects")
        .select("id, name, repo_url, workspace_id")
        .in("workspace_id", workspaceIds);
        
      if (error) return `Error fetching projects: ${error.message}`;
      if (!projects || projects.length === 0) return "You don't have any projects in your workspaces.";
      
      return JSON.stringify(projects, null, 2);
    },
    {
      name: "list_projects",
      description: "List all projects the user has access to. Returns project ID, name, and repo_url.",
      schema: z.object({})
    }
  );

  const triggerReviewTool = tool(
    async ({ projectId }) => {
      const { data: review, error } = await supabaseAdmin.from("reviews").insert({
        project_id: projectId, status: "queued", requested_by: userId, ref: "HEAD"
      }).select().single();
      
      if (error) return `Failed to trigger review: ${error.message}`;
      
      runReviewJob({ reviewId: review.id }).catch(console.error);
      return `Code review triggered successfully! Review ID: ${review.id}`;
    },
    {
      name: "trigger_code_review",
      description: "Trigger a background AI code review for a specific project. Use the project ID from list_projects.",
      schema: z.object({ projectId: z.string().uuid() })
    }
  );

  const readProjectFileTool = tool(
    async ({ projectId, path }) => {
      const { data: file, error } = await supabaseAdmin.from("editor_files")
        .select("content")
        .eq("sandbox_id", projectId)
        .eq("path", path)
        .maybeSingle();
      
      if (error) return `Error fetching file: ${error.message}`;
      if (!file) return `File not found at path: ${path} (make sure the project sandbox is initialized)`;
      
      return file.content;
    },
    {
      name: "read_project_file",
      description: "Read the contents of a file in the project's editor sandbox.",
      schema: z.object({ projectId: z.string().uuid(), path: z.string() })
    }
  );

  const editProjectFileTool = tool(
    async ({ projectId, path, content }) => {
      const { error } = await supabaseAdmin.from("editor_files").upsert({
        sandbox_id: projectId, path, content, size: content.length, type: "file", updated_at: new Date().toISOString()
      }, { onConflict: "sandbox_id,path" });
      
      if (error) return `Failed to edit file: ${error.message}`;
      return `File ${path} successfully updated in the project sandbox!`;
    },
    {
      name: "edit_project_file",
      description: "Write or update a file in the project's editor sandbox. You must provide the COMPLETE file content.",
      schema: z.object({ projectId: z.string().uuid(), path: z.string(), content: z.string() })
    }
  );

  return [listProjectsTool, triggerReviewTool, readProjectFileTool, editProjectFileTool];
}
