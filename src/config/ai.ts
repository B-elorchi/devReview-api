import { ChatOpenAI } from "@langchain/openai";
import { env } from "./env.js";

// LangChain OpenRouter Configuration
export const chatModel = new ChatOpenAI({
  modelName: env.AI_MODEL_DEFAULT,
  openAIApiKey: env.OPENROUTER_API_KEY || "dummy", // Fallback to avoid crash if env missing during build
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": env.APP_URL, // OpenRouter requires Referer
      "X-Title": "DevReview AI", // OpenRouter requires Title
    },
  },
  temperature: 0, // Deterministic for code reviews
});

export const models = {
  default: env.AI_MODEL_DEFAULT,
  review: env.AI_MODEL_REVIEW,
};
