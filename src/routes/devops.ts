import { Router } from "express";
import { z } from "zod";
import { streamText } from "ai";
import { requireAuth } from "../middleware/auth.js";
import { aiLimiter } from "../middleware/rateLimit.js";
import { models } from "../config/ai.js";
import { openSse, sseSend, sseClose } from "../utils/sse.js";

const r = Router();
r.use(requireAuth);

r.post("/generate", async (req, res) => {
  res.json({
    generated: {
      Dockerfile: { lang: "dockerfile", content: `FROM node:20-alpine\nWORKDIR /app\nCOPY package.json .\nRUN npm i\nCOPY . .\nCMD ["npm", "start"]` },
      "docker-compose.yml": { lang: "yaml", content: `version: '3.9'\nservices:\n  api:\n    build: .\n    ports: ["3000:3000"]` },
      "github-actions.yml": { lang: "yaml", content: `name: CI\non: [push]\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4` },
    }
  });
});

export default r;
