import { ChatOpenAI } from "@langchain/openai";
import { env } from "./env.js";

export const chatModel = new ChatOpenAI({
  modelName: env.AI_MODEL_DEFAULT,
  apiKey: env.AI_GATEWAY_API_KEY || env.OPENROUTER_API_KEY || "dummy",
  configuration: {
    baseURL: env.AI_GATEWAY_URL,
    defaultHeaders: {
      "HTTP-Referer": env.APP_URL,
      "X-Title": "DevReview AI",
    },
  },
  temperature: 0,
});

export const models = {
  default: env.AI_MODEL_DEFAULT,
  review: env.AI_MODEL_REVIEW,
};
