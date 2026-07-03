import { createServer } from "http";
import { WebSocket, WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { redis } from "./config/redis.js";
import { supabaseAdmin } from "./config/supabase.js";
import { NOTIFICATION_CHANNEL, type NotificationPayload } from "./services/notificationRealtime.js";
import { logger } from "./utils/logger.js";
import os from "os";

const app = createApp();
const server = createServer(app);

let pty: any = null;
try {
  pty = await import("node-pty");
} catch {
  logger.warn("node-pty not available, terminal will be disabled.");
}

const terminalWss = new WebSocketServer({ noServer: true });
const notificationWss = new WebSocketServer({ noServer: true });
const notificationClients = new Map<string, Set<WebSocket>>();

const notificationSubscriber = redis.duplicate();
await notificationSubscriber.subscribe(NOTIFICATION_CHANNEL);
notificationSubscriber.on("message", (_channel, raw) => {
  try {
    const notification = JSON.parse(raw) as NotificationPayload;
    const clients = notificationClients.get(notification.user_id);
    if (!clients?.size) return;

    const message = JSON.stringify({ type: "notification", notification });
    for (const client of clients) {
      if (client.readyState === WebSocket.OPEN) client.send(message);
    }
  } catch (error) {
    logger.error({ error }, "failed to broadcast notification websocket event");
  }
});

function addNotificationClient(userId: string, ws: WebSocket) {
  const clients = notificationClients.get(userId) ?? new Set<WebSocket>();
  clients.add(ws);
  notificationClients.set(userId, clients);
  ws.on("close", () => {
    clients.delete(ws);
    if (clients.size === 0) notificationClients.delete(userId);
  });
}

async function authenticateNotificationSocket(reqUrl: string | undefined) {
  if (!reqUrl) return null;
  const url = new URL(reqUrl, `http://localhost:${env.PORT}`);
  const token = url.searchParams.get("token");
  if (!token) return null;

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user;
}

server.on("upgrade", async (req, socket, head) => {
  if (req.url?.startsWith("/api/v1/notifications/ws")) {
    const user = await authenticateNotificationSocket(req.url);
    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    notificationWss.handleUpgrade(req, socket, head, (ws) => {
      addNotificationClient(user.id, ws);
      ws.send(JSON.stringify({ type: "ready" }));
    });
    return;
  }

  if (req.url?.startsWith("/api/v1/editor/sandboxes/") && req.url.endsWith("/terminal")) {
    terminalWss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "ready" }));

      if (!pty) {
        ws.send(JSON.stringify({ type: "data", chunk: "Terminal backend (node-pty) not installed.\r\n" }));
        return;
      }

      const shell = os.platform() === "win32" ? "powershell.exe" : "bash";
      const ptyProcess = pty.spawn(shell, [], {
        name: "xterm-color",
        cols: 80,
        rows: 24,
        cwd: process.env.USERPROFILE || process.cwd(),
        env: process.env,
      });

      ptyProcess.onData((data: string) => {
        ws.send(JSON.stringify({ type: "data", chunk: data }));
      });

      ws.on("message", (msg) => {
        try {
          const parsed = JSON.parse(msg.toString());
          if (parsed.type === "data" && parsed.chunk) {
            ptyProcess.write(parsed.chunk);
          } else if (parsed.type === "resize") {
            ptyProcess.resize(parsed.cols, parsed.rows);
          }
        } catch (error) {
          logger.error({ error }, "invalid terminal websocket message");
        }
      });

      ws.on("close", () => {
        ptyProcess.kill();
      });
    });
    return;
  }

  socket.destroy();
});

server.listen(env.PORT, () => {
  logger.info(`API on http://localhost:${env.PORT}`);
});