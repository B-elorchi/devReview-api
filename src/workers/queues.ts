import { Queue } from "bullmq";
import { redis } from "../config/redis.js";

const connection = redis as any;
export const reviewQueue = new Queue("review", { connection });
export const githubSyncQueue = new Queue("github.sync", { connection });
export const editorReaperQueue = new Queue("editor.reaper", { connection });
export const telegramQueue = new Queue("telegram", { connection });
