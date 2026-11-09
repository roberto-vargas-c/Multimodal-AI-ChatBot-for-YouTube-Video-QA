import { ChatAnthropic } from "@langchain/anthropic";
import type { Env } from "./types";

// No temperature, top_p or top_k: current Claude models (Haiku 5.5 and later) reject them with a 400. They think adaptively by
// default, and that thinking counts toward maxTokens, so the default leaves room for it.
export function chatModel(env: Env, opts: { maxTokens?: number } = {}) {
  return new ChatAnthropic({
    model: env.CHAT_MODEL ?? "claude-haiku-5-5",
    apiKey: env.ANTHROPIC_API_KEY,
    maxTokens: opts.maxTokens ?? 4000,
  });
}

/** Where the day's cap on paid model calls stands. The day is UTC, so the count starts again at 00:00 UTC */
export interface Budget { ok: boolean; used: number; cap: number; resetsAt: string }

export const capOf = (env: Env) => { const n = Number(env.AI_PER_DAY); return Number.isFinite(n) && n > 0 ? Math.floor(n) : 300; };

/** The next 00:00 UTC after `now`, when the count starts again */
export function nextReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

/**
 * Counts `calls` paid calls against the day's cap for the whole Worker. A request that would pass the cap is refused and not
 * counted, so the refusals do not use up what is left. The owner (a presenter signed in as curator) is counted but never refused.
 */
export async function spend(env: Env, calls = 1, owner = false, now = new Date()): Promise<Budget> {
  const day = now.toISOString().slice(0, 10), cap = capOf(env), resetsAt = nextReset(now).toISOString();
  const row = await env.DB.prepare(`INSERT INTO usage (day, calls) VALUES (?1, ?2)
      ON CONFLICT(day) DO UPDATE SET calls = calls + ?2 RETURNING calls`).bind(day, calls).first<{ calls: number }>();
  const used = row?.calls ?? 0;
  if (used <= cap || owner) return { ok: true, used, cap, resetsAt };
  await env.DB.prepare("UPDATE usage SET calls = calls - ?2 WHERE day = ?1").bind(day, calls).run();
  return { ok: false, used: used - calls, cap, resetsAt };
}

/** The day's count without spending anything: for /api/health, to check before a presentation */
export async function usage(env: Env, now = new Date()): Promise<Omit<Budget, "ok">> {
  const row = await env.DB.prepare("SELECT calls FROM usage WHERE day = ?1").bind(now.toISOString().slice(0, 10)).first<{ calls: number }>();
  return { used: row?.calls ?? 0, cap: capOf(env), resetsAt: nextReset(now).toISOString() };
}

/** What the panel shows when the cap is reached: what happened, that nothing is broken, and when it opens again */
export function limitMessage(b: Omit<Budget, "ok">, lang?: string, now = new Date()): string {
  const mins = Math.max(1, Math.ceil((Date.parse(b.resetsAt) - now.getTime()) / 60000));
  const wait = mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : `${mins} min`;
  return lang?.toLowerCase().startsWith("de")
    ? `Die Jury hat heute ihr Kontingent von ${b.cap} Modellaufrufen aufgebraucht. Das ist eine Kostenbremse, kein Fehler: Die Bibliothek und alles andere in Keystone funktionieren weiter. Um 00:00 UTC (in ${wait}) geht es weiter.`
    : `The jury has used today's ${b.cap} model calls. This is a cost limit, not a fault: the library and the rest of Keystone keep working. It opens again at 00:00 UTC (in ${wait}).`;
}

/** The text of a model answer, whether it came as a string or as content blocks */
export function text(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(b => (typeof b === "string" ? b : b?.type === "text" ? b.text : "")).join("");
  return "";
}
