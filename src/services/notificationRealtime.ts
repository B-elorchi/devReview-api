import { redis } from "../config/redis.js";
import { logger } from "../utils/logger.js";

export const NOTIFICATION_CHANNEL = "notifications.created";

export type NotificationPayload = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export async function publishNotification(notification: NotificationPayload) {
  try {
    await redis.publish(NOTIFICATION_CHANNEL, JSON.stringify(notification));
  } catch (error) {
    logger.error({ error, notificationId: notification.id }, "failed to publish notification websocket event");
  }
}