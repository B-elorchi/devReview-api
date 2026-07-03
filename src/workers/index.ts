import { Worker } from "bullmq";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { runReviewJob } from "../services/review.js";

const connection = redis as any;

new Worker("review", async (job) => {
  logger.info({ jobId: job.id }, "running review job");
  await runReviewJob(job.data as { reviewId: string; diff?: string });
}, { connection });

new Worker("github.sync", async (job) => {
  logger.info({ event: job.name }, "github.sync");
  // TODO: handle pull_request, push, installation events
}, { connection });

new Worker("editor.reaper", async () => {
  // TODO: reap idle sandboxes
}, { connection });

new Worker("telegram", async () => {
  // TODO: route telegram updates
}, { connection });

logger.info("Workers ready");
