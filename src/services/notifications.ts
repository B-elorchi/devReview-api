import { notificationQueue } from "../workers/queues.js";
import { logger } from "../utils/logger.js";

export type NotificationType =
  | "team"
  | "review"
  | "project"
  | "pr"
  | "devops"
  | "agent"
  | "success"
  | "alert";

export type NotificationPreferenceKey =
  | "push_review_complete"
  | "push_pr_opened"
  | "push_deploy_failed"
  | "push_weekly_report";

export type NotificationJobData = {
  userId: string;
  type: NotificationType;
  title: string;
  body?: string;
  link?: string;
  preferenceKey?: NotificationPreferenceKey;
};

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential", delay: 1_000 },
  removeOnComplete: 500,
  removeOnFail: 1_000,
} as const;

export async function enqueueNotification(data: NotificationJobData) {
  try {
    await notificationQueue.add("create", data, defaultJobOptions);
  } catch (error) {
    logger.error({ error, userId: data.userId, type: data.type }, "failed to enqueue notification");
    throw error;
  }
}

export async function enqueueNotifications(items: NotificationJobData[]) {
  await Promise.all(items.map((item) => enqueueNotification(item)));
}