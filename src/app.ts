import "express-async-errors";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import { env } from "./config/env.js";
import { apiLimiter } from "./middleware/rateLimit.js";
import { errorHandler, notFound } from "./middleware/error.js";

import swaggerUi from "swagger-ui-express";
import { openapiSpec } from "./openapi.js";
import auth from "./routes/auth.js";
import workspaces from "./routes/workspaces.js";
import projects from "./routes/projects.js";
import reviews from "./routes/reviews.js";
import devops from "./routes/devops.js";
import agents from "./routes/agents.js";
import editor from "./routes/editor.js";
import github from "./routes/integrations.github.js";
import telegram from "./routes/integrations.telegram.js";
import apiKeys from "./routes/apiKeys.js";
import billing from "./routes/billing.js";
import notifications from "./routes/notifications.js";
import auditLog from "./routes/auditLog.js";
import pullRequests from "./routes/pullRequests.js";
import templates from "./routes/templates.js";
import webhooks from "./routes/webhooks.js";
import analytics from "./routes/analytics.js";
import settings from "./routes/settings.js";
import misc from "./routes/misc.js";
import ai from "./routes/ai.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(cors({ origin: env.APP_URL, credentials: true }));
  app.use(compression());
  app.use(morgan(env.NODE_ENV === "development" ? "dev" : "combined"));

  app.get("/healthz", (_req, res) => res.json({ ok: true, ts: Date.now() }));

  // OpenAPI / Swagger UI
  app.get("/api-docs.json", (_req, res) => res.json(openapiSpec));
  app.use(
    "/api-docs",
    swaggerUi.serve,
    swaggerUi.setup(openapiSpec, {
      explorer: true,
      customSiteTitle: "DevReview AI API",
    }),
  );

  // Webhook routes need raw body — mount BEFORE express.json().
  app.use("/api/v1/integrations/github", github);

  app.use(express.json({ limit: "2mb" }));
  app.use(apiLimiter);

  app.use("/api/v1/billing", billing);

  app.use("/api/v1/auth", auth);
  app.use("/api/v1/workspaces", workspaces);
  app.use("/api/v1/projects", projects);
  app.use("/api/v1", reviews); // /projects/:id/reviews + /reviews/:id
  app.use("/api/v1/devops", devops);
  app.use("/api/v1/agents", agents);
  app.use("/api/v1/editor", editor);
  app.use("/api/v1/integrations/telegram", telegram);
  app.use("/api/v1/api-keys", apiKeys);
  app.use("/api/v1/notifications", notifications);
  app.use("/api/v1/audit-log", auditLog);
  app.use("/api/v1/pull-requests", pullRequests);
  app.use("/api/v1/templates", templates);
  app.use("/api/v1/webhooks", webhooks);
  app.use("/api/v1/analytics", analytics);
  app.use("/api/v1/settings", settings);
  app.use("/api/v1/ai", ai);
  app.use("/api/v1", misc); // /search, /ready, /version

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
