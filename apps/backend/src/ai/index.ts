import { DeterministicAI } from "./deterministicAi.js";
import { env } from "../config/env.js";
import { GroqConversationalService } from "./groqConversationalService.js";
import type { ConversationalAI } from "./types.js";

export function createConversationalAI(): ConversationalAI {
  if (env.GROQ_API_KEY) {
    return new GroqConversationalService();
  }

  return new DeterministicAI();
}
