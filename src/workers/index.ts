import { Worker } from "bullmq";
import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";
import { runReviewJob } from "../services/review.js";
import { supabaseAdmin } from "../config/supabase.js";
import type { NotificationJobData } from "../services/notifications.js";
import { publishNotification } from "../services/notificationRealtime.js";

const connection = redis as any;

function isMissingTableError(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "PGRST205";
}

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


new Worker("notification", async (job) => {
  const data = job.data as NotificationJobData;
  logger.info({ jobId: job.id, userId: data.userId, type: data.type }, "creating notification");

  if (data.preferenceKey) {
    const { data: prefs, error: prefError } = await supabaseAdmin
      .from("notification_preferences")
      .select(data.preferenceKey)
      .eq("user_id", data.userId)
      .maybeSingle();
    if (prefError) {
      if (isMissingTableError(prefError)) {
        logger.warn("notification_preferences table missing; delivering notification with default preferences");
      } else {
        throw prefError;
      }
    }

    const preferenceValue = prefError ? undefined : (prefs as Record<string, boolean> | null)?.[data.preferenceKey];
    if (preferenceValue === false) {
      logger.info({ userId: data.userId, preferenceKey: data.preferenceKey }, "notification skipped by preference");
      return;
    }
  }

  const { data: notification, error } = await supabaseAdmin.from("notifications").insert({
    user_id: data.userId,
    type: data.type,
    title: data.title,
    body: data.body ?? null,
    link: data.link ?? null,
  }).select().single();
  if (error) throw error;
  if (notification) await publishNotification(notification);
}, { connection });
logger.info("Workers ready");
