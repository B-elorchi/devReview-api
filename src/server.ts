import { createServer } from "http";
import { WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";

const app = createApp();
const server = createServer(app);

import os from "os";

// We'll dynamically import node-pty so the server doesn't crash if it fails to build
let pty: any = null;
try {
  pty = await import("node-pty");
} catch (e) {
  logger.warn("node-pty not available, terminal will be disabled.");
}

// WebSocket: /v1/editor/sandboxes/:id/terminal
const wss = new WebSocketServer({ noServer: true });
server.on("upgrade", (req, socket, head) => {
  if (req.url?.startsWith("/api/v1/editor/sandboxes/") && req.url.endsWith("/terminal")) {
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.send(JSON.stringify({ type: "ready" }));

      if (!pty) {
        ws.send(JSON.stringify({ type: "data", chunk: "Terminal backend (node-pty) not installed.\\r\\n" }));
        return;
      }

      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.USERPROFILE || process.cwd(),
        env: process.env
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
        } catch (e) {
          console.error("Invalid WS message:", e);
        }
      });

      ws.on("close", () => {
        ptyProcess.kill();
      });
    });
  } else {
    socket.destroy();
  }
});

server.listen(env.PORT, () => {
  logger.info(`API on http://localhost:${env.PORT}`);
});
