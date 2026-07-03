// OpenAPI 3.0 specification for DevReview AI backend.
// Served at /api-docs (Swagger UI) and /api-docs.json (raw spec).

export const openapiSpec = {
  openapi: "3.0.3",
  info: {
    title: "DevReview AI API",
    version: "0.1.0",
    description:
      "REST API for the DevReview AI platform — AI code review, DevOps generation, multi-agent workflows, IDE sandboxes, GitHub & Telegram integrations, billing, and audit logging.",
  },
  servers: [
    { url: "http://localhost:8080", description: "Local dev" },
    { url: "https://api.devreview.ai", description: "Production" },
  ],
  tags: [
    { name: "Health" },
    { name: "Auth" },
    { name: "Workspaces" },
    { name: "Projects" },
    { name: "Reviews" },
    { name: "Pull Requests" },
    { name: "DevOps" },
    { name: "Agents" },
    { name: "Editor" },
    { name: "Integrations · GitHub" },
    { name: "Integrations · Telegram" },
    { name: "API Keys" },
    { name: "Billing" },
    { name: "Notifications" },
    { name: "Audit Log" },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "Supabase access token",
      },
      workspaceHeader: {
        type: "apiKey",
        in: "header",
        name: "x-workspace-id",
        description: "Active workspace UUID",
      },
      apiKey: {
        type: "apiKey",
        in: "header",
        name: "x-api-key",
        description: "Programmatic API key (for machine clients)",
      },
    },
    parameters: {
      WorkspaceId: {
        name: "x-workspace-id",
        in: "header",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      IdPath: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: { type: "string" },
          message: { type: "string" },
          details: { type: "object", additionalProperties: true },
        },
        required: ["error"],
      },
      Ok: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
      Workspace: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          slug: { type: "string" },
          plan: { type: "string", enum: ["free", "pro", "enterprise"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      WorkspaceMember: {
        type: "object",
        properties: {
          user_id: { type: "string", format: "uuid" },
          role: { type: "string", enum: ["owner", "admin", "member", "viewer"] },
          email: { type: "string", format: "email" },
        },
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          workspace_id: { type: "string", format: "uuid" },
          name: { type: "string" },
          repo_url: { type: "string", format: "uri" },
          default_branch: { type: "string", example: "main" },
          language: { type: "string" },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Review: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          project_id: { type: "string", format: "uuid" },
          status: {
            type: "string",
            enum: ["queued", "running", "completed", "failed"],
          },
          score: { type: "number", nullable: true },
          summary: { type: "string", nullable: true },
          findings: { type: "array", items: { $ref: "#/components/schemas/Finding" } },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Finding: {
        type: "object",
        properties: {
          file: { type: "string" },
          line: { type: "integer" },
          severity: { type: "string", enum: ["info", "warn", "error", "critical"] },
          rule: { type: "string" },
          message: { type: "string" },
          suggestion: { type: "string", nullable: true },
        },
      },
      PullRequest: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          number: { type: "integer" },
          title: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "merged"] },
          author: { type: "string" },
          url: { type: "string", format: "uri" },
        },
      },
      DevOpsGenerateRequest: {
        type: "object",
        required: ["stack", "target"],
        properties: {
          stack: { type: "string", example: "node-express" },
          target: {
            type: "string",
            enum: ["dockerfile", "compose", "github-actions", "k8s", "terraform"],
          },
          options: { type: "object", additionalProperties: true },
        },
      },
      Agent: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          description: { type: "string" },
          system_prompt: { type: "string" },
          model: { type: "string", example: "google/gemini-3-flash-preview" },
          tools: { type: "array", items: { type: "string" } },
        },
      },
      AgentSession: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          agent_id: { type: "string", format: "uuid" },
          status: { type: "string", enum: ["running", "completed", "failed"] },
          output: { type: "string" },
          steps: { type: "array", items: { type: "object" } },
        },
      },
      Sandbox: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          template: { type: "string", example: "node-20" },
          status: { type: "string", enum: ["provisioning", "ready", "stopped"] },
          url: { type: "string", format: "uri", nullable: true },
        },
      },
      SandboxFile: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
      },
      ApiKey: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          name: { type: "string" },
          prefix: { type: "string", example: "dvr_live_" },
          created_at: { type: "string", format: "date-time" },
          last_used_at: { type: "string", format: "date-time", nullable: true },
        },
      },
      ApiKeyCreated: {
        allOf: [
          { $ref: "#/components/schemas/ApiKey" },
          {
            type: "object",
            properties: {
              token: {
                type: "string",
                description: "Plain-text key, returned ONCE on creation.",
              },
            },
          },
        ],
      },
      Notification: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          type: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          read_at: { type: "string", format: "date-time", nullable: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      AuditEntry: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          actor_id: { type: "string", format: "uuid" },
          action: { type: "string" },
          target: { type: "string" },
          metadata: { type: "object", additionalProperties: true },
          created_at: { type: "string", format: "date-time" },
        },
      },
      EditorChatRequest: {
        type: "object",
        required: ["messages"],
        properties: {
          messages: { type: "array", items: { type: "object" } },
          fileName: { type: "string" },
          fileLang: { type: "string" },
          fileContent: { type: "string" },
        },
      },
    },
    responses: {
      Unauthorized: {
        description: "Missing or invalid credentials",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      NotFound: {
        description: "Resource not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
      RateLimited: {
        description: "Rate limit exceeded",
        content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
      },
    },
  },
  security: [{ bearerAuth: [] }, { apiKey: [] }],
  paths: {
    "/healthz": {
      get: {
        tags: ["Health"],
        summary: "Liveness probe",
        security: [],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { ok: { type: "boolean" }, ts: { type: "integer" } },
                },
              },
            },
          },
        },
      },
    },

    "/api/v1/auth/session": {
      post: {
        tags: ["Auth"],
        summary: "Exchange Supabase JWT for a session and ensure profile",
        responses: {
          200: {
            description: "Session info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    user: { type: "object" },
                    workspaces: { type: "array", items: { $ref: "#/components/schemas/Workspace" } },
                  },
                },
              },
            },
          },
          401: { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
    "/api/v1/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout (server-side hint; client must clear token)",
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },

    "/api/v1/workspaces": {
      get: {
        tags: ["Workspaces"],
        summary: "List workspaces the current user belongs to",
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Workspace" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["Workspaces"],
        summary: "Create a workspace",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" }, slug: { type: "string" } },
              },
            },
          },
        },
        responses: {
          201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Workspace" } } } },
        },
      },
    },
    "/api/v1/workspaces/{id}/members": {
      get: {
        tags: ["Workspaces"],
        summary: "List members of a workspace",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/WorkspaceMember" } },
              },
            },
          },
        },
      },
    },

    "/api/v1/projects": {
      get: {
        tags: ["Projects"],
        summary: "List projects in the active workspace",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        responses: {
          200: {
            description: "OK",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/Project" } },
              },
            },
          },
        },
      },
      post: {
        tags: ["Projects"],
        summary: "Create a project",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name", "repo_url"],
                properties: {
                  name: { type: "string" },
                  repo_url: { type: "string", format: "uri" },
                  default_branch: { type: "string" },
                  language: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } } },
      },
    },
    "/api/v1/projects/{id}": {
      parameters: [{ $ref: "#/components/parameters/IdPath" }, { $ref: "#/components/parameters/WorkspaceId" }],
      get: {
        tags: ["Projects"],
        summary: "Get a project by id",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["Projects"],
        summary: "Update a project",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  default_branch: { type: "string" },
                  language: { type: "string" },
                },
              },
            },
          },
        },
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Project" } } } } },
      },
      delete: {
        tags: ["Projects"],
        summary: "Delete a project",
        responses: { 204: { description: "Deleted" } },
      },
    },

    "/api/v1/projects/{id}/reviews": {
      post: {
        tags: ["Reviews"],
        summary: "Enqueue a new AI review for a project",
        parameters: [{ $ref: "#/components/parameters/IdPath" }, { $ref: "#/components/parameters/WorkspaceId" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  ref: { type: "string", example: "main" },
                  pr_number: { type: "integer", nullable: true },
                  rules: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: {
          202: { description: "Queued", content: { "application/json": { schema: { $ref: "#/components/schemas/Review" } } } },
        },
      },
    },
    "/api/v1/reviews/{id}": {
      get: {
        tags: ["Reviews"],
        summary: "Get review by id (status + findings when complete)",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Review" } } } },
          404: { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/api/v1/projects/{id}/pull-requests": {
      get: {
        tags: ["Pull Requests"],
        summary: "List pull requests synced from GitHub for a project",
        parameters: [{ $ref: "#/components/parameters/IdPath" }, { $ref: "#/components/parameters/WorkspaceId" }],
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/PullRequest" } } } },
          },
        },
      },
    },

    "/api/v1/devops/generate": {
      post: {
        tags: ["DevOps"],
        summary: "Stream AI-generated DevOps assets (SSE)",
        description: "Returns text/event-stream with incremental tokens.",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/DevOpsGenerateRequest" } } },
        },
        responses: {
          200: {
            description: "Server-Sent Events stream",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/agents": {
      get: {
        tags: ["Agents"],
        summary: "List agents in the workspace",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Agent" } } } } },
        },
      },
      post: {
        tags: ["Agents"],
        summary: "Create an agent",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } },
        },
        responses: { 201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Agent" } } } } },
      },
    },
    "/api/v1/agents/{id}/run": {
      post: {
        tags: ["Agents"],
        summary: "Run an agent (streams SSE)",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  input: { type: "string" },
                  context: { type: "object", additionalProperties: true },
                },
              },
            },
          },
        },
        responses: {
          200: { description: "SSE stream", content: { "text/event-stream": { schema: { type: "string" } } } },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/v1/agents/sessions/{id}": {
      get: {
        tags: ["Agents"],
        summary: "Get a past agent run session",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/AgentSession" } } } } },
      },
    },

    "/api/v1/editor/sandboxes": {
      post: {
        tags: ["Editor"],
        summary: "Provision an ephemeral sandbox",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  template: { type: "string", example: "node-20" },
                  project_id: { type: "string", format: "uuid", nullable: true },
                },
              },
            },
          },
        },
        responses: { 201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/Sandbox" } } } } },
      },
    },
    "/api/v1/editor/sandboxes/{id}/files": {
      parameters: [{ $ref: "#/components/parameters/IdPath" }],
      get: {
        tags: ["Editor"],
        summary: "List/read files in a sandbox",
        parameters: [{ name: "path", in: "query", required: false, schema: { type: "string" } }],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { oneOf: [{ type: "array", items: { $ref: "#/components/schemas/SandboxFile" } }, { $ref: "#/components/schemas/SandboxFile" }] } } } },
        },
      },
      put: {
        tags: ["Editor"],
        summary: "Write a file in the sandbox",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/SandboxFile" } } },
        },
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/api/v1/editor/chat": {
      post: {
        tags: ["Editor"],
        summary: "AI Composer chat for the current file (SSE)",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/EditorChatRequest" } } },
        },
        responses: {
          200: { description: "SSE stream", content: { "text/event-stream": { schema: { type: "string" } } } },
          429: { $ref: "#/components/responses/RateLimited" },
        },
      },
    },

    "/api/v1/integrations/github/install-url": {
      get: {
        tags: ["Integrations · GitHub"],
        summary: "Get the GitHub App install URL",
        responses: {
          200: {
            description: "OK",
            content: { "application/json": { schema: { type: "object", properties: { url: { type: "string", format: "uri" } } } } },
          },
        },
      },
    },
    "/api/v1/integrations/github/webhook": {
      post: {
        tags: ["Integrations · GitHub"],
        summary: "GitHub webhook receiver (signature-verified)",
        security: [],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "OK" }, 401: { description: "Bad signature" } },
      },
    },
    "/api/v1/integrations/telegram/link": {
      post: {
        tags: ["Integrations · Telegram"],
        summary: "Link the current user to a Telegram account",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", properties: { code: { type: "string" } } } } },
        },
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },
    "/api/v1/integrations/telegram/webhook": {
      post: {
        tags: ["Integrations · Telegram"],
        summary: "Telegram bot webhook",
        security: [],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "OK" } },
      },
    },

    "/api/v1/api-keys": {
      get: {
        tags: ["API Keys"],
        summary: "List API keys",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ApiKey" } } } } } },
      },
      post: {
        tags: ["API Keys"],
        summary: "Create an API key (plaintext returned ONCE)",
        parameters: [{ $ref: "#/components/parameters/WorkspaceId" }],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object", required: ["name"], properties: { name: { type: "string" } } } } },
        },
        responses: { 201: { description: "Created", content: { "application/json": { schema: { $ref: "#/components/schemas/ApiKeyCreated" } } } } },
      },
    },
    "/api/v1/api-keys/{id}": {
      delete: {
        tags: ["API Keys"],
        summary: "Revoke an API key",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: { 204: { description: "Deleted" } },
      },
    },

    "/api/v1/billing/portal": {
      get: {
        tags: ["Billing"],
        summary: "Create a Stripe customer portal session",
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { type: "object", properties: { url: { type: "string", format: "uri" } } } } } },
        },
      },
    },
    "/api/v1/billing/webhook": {
      post: {
        tags: ["Billing"],
        summary: "Stripe webhook receiver (signature-verified)",
        security: [],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { 200: { description: "OK" }, 401: { description: "Bad signature" } },
      },
    },

    "/api/v1/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "List notifications for the current user",
        responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/Notification" } } } } } },
      },
    },
    "/api/v1/notifications/{id}/read": {
      post: {
        tags: ["Notifications"],
        summary: "Mark a notification as read",
        parameters: [{ $ref: "#/components/parameters/IdPath" }],
        responses: { 200: { description: "OK", content: { "application/json": { schema: { $ref: "#/components/schemas/Ok" } } } } },
      },
    },

    "/api/v1/audit-log": {
      get: {
        tags: ["Audit Log"],
        summary: "Query the workspace audit log",
        parameters: [
          { $ref: "#/components/parameters/WorkspaceId" },
          { name: "actor_id", in: "query", schema: { type: "string", format: "uuid" } },
          { name: "action", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "to", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
        ],
        responses: {
          200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/AuditEntry" } } } } },
        },
      },
    },
  },
} as const;
