import { UserProfile } from "../types/context";
import { generateOpenAiAnswer } from "./openai";
import { LlmConfig } from "../types/context";

export async function generateLongformAnswer(
  prompt: { question: string; profile: UserProfile },
  config?: LlmConfig
): Promise<string | null> {
  if (!config || !config.enabled) {
    return null;
  }

  if (config.provider !== "openai") {
    return null;
  }

  return generateOpenAiAnswer(prompt, {
    model: config.model,
    maxOutputTokens: config.maxOutputTokens,
  });
}
