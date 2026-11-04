import { ChatAnthropic } from "@langchain/anthropic";
import type { Env } from "./types";

export function chatModel(env: Env, opts: { maxTokens?: number; temperature?: number } = {}) {
  return new ChatAnthropic({
    model: env.CHAT_MODEL ?? "claude-haiku-5-5",
    apiKey: env.ANTHROPIC_API_KEY,
    maxTokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
  });
}

/** Counts a paid call against the day's cap for the whole Worker; false when the cap is reached */
export async function allow(env: Env, calls = 1): Promise<boolean> {
  const day = new Date().toISOString().slice(0, 10), cap = Number(env.AI_PER_DAY ?? 300);
  const row = await env.DB.prepare(`INSERT INTO usage (day, calls) VALUES (?1, ?2)
      ON CONFLICT(day) DO UPDATE SET calls = calls + ?2 RETURNING calls`).bind(day, calls).first<{ calls: number }>();
  return (row?.calls ?? 0) <= cap;
}

/** The text of a model answer, whether it came as a string or as content blocks */
export function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(b => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("");
  return "";
}
