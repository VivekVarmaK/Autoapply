import { UserProfile } from "../types/context";

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

export interface OpenAiConfig {
  model: string;
  maxOutputTokens: number;
}

export async function generateOpenAiAnswer(
  prompt: { question: string; profile: UserProfile },
  config: OpenAiConfig
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }

  const system =
    "You are drafting concise, professional job application responses. Use the candidate profile only. Keep responses under 1200 characters unless asked.";

  const user = buildUserPrompt(prompt.profile, prompt.question);

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: config.maxOutputTokens,
      temperature: 0.4,
    }),
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content?.trim();
  return content || null;
}

function buildUserPrompt(profile: UserProfile, question: string): string {
  const summary = profile.summary ? `Summary: ${profile.summary}` : "";
  const skills = profile.skills && profile.skills.length > 0 ? `Skills: ${profile.skills.join(", ")}` : "";
  const links = [profile.linkedin && `LinkedIn: ${profile.linkedin}`, profile.github && `GitHub: ${profile.github}`]
    .filter(Boolean)
    .join("\n");

  return [
    "Candidate Profile:",
    `Name: ${profile.fullName}`,
    `Location: ${profile.location ?? ""}`,
    summary,
    skills,
    links,
    "\nQuestion:",
    question,
    "\nAnswer:",
  ]
    .filter((line) => line && line.trim().length > 0)
    .join("\n");
}
