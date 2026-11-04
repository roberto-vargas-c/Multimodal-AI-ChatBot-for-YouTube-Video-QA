// Facts the bot writes into Keystone's knowledge base. They are stored in D1 in Keystone's own shape (facts/<category>.json:
// id, q, country, typology, en, value, evidence [{ source, where }], target) and Keystone merges GET /api/facts with its files.
// Confidence follows Keystone: 1 - Π(1 - weight) over distinct sources, × 0.7 when they disagree; from 0.5 a fact applies.
// One video (0.25) or one book (0.3) stays under Needs review; a second source on the same answer lifts it.
import { isQuestion, kindWeight } from "./taxonomy";
import type { Env } from "./types";

export interface Evidence { source: string; where: string; kind?: string; quote?: string }
export interface Fact {
  id: string; category: string; q: string; country: string; typology: string; en: string; value: string; target?: string;
  evidence: Evidence[]; agree?: boolean; review?: string;
}

export const APPLIES = 0.5;

export function confidence(evidence: Evidence[], agree = true): number {
  const bySource = new Map<string, number>();
  for (const e of evidence) bySource.set(e.source, Math.max(bySource.get(e.source) ?? 0, kindWeight[e.kind ?? ""] ?? 0.2));
  const c = 1 - [...bySource.values()].reduce((p, w) => p * (1 - w), 1);
  return Math.round(c * (agree ? 1 : 0.7) * 100) / 100;
}

export function status(f: Pick<Fact, "evidence" | "agree" | "review">): "applied" | "review" | "rejected" {
  if (f.review === "rejected") return "rejected";
  if (f.review === "confirmed") return "applied";
  if (f.agree === false) return "review";
  return confidence(f.evidence) < APPLIES ? "review" : "applied";
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export interface Proposal { category: string; q: string; country: string; typology: string; en: string; value: string; evidence: Evidence }

/**
 * Adds a fact, or adds evidence to the fact with the same answer to the same question for the same country and building type.
 * Another answer to that question for the same country and type marks both as disagreeing, as Keystone does.
 */
export async function propose(env: Env, p: Proposal): Promise<{ fact: Fact; created: boolean; confidence: number; status: string }> {
  if (!isQuestion(p.category, p.q)) throw new Error(`Unknown question ${p.category}.${p.q}`);
  const rows = (await env.DB.prepare("SELECT * FROM facts WHERE category = ?1 AND q = ?2 AND country = ?3 AND typology = ?4")
    .bind(p.category, p.q, p.country, p.typology).all<Row>()).results.map(fromRow);
  let fact = rows.find(f => norm(f.value) === norm(p.value));
  const created = !fact;
  if (fact) {
    if (!fact.evidence.some(e => e.source === p.evidence.source && e.where === p.evidence.where)) fact.evidence.push(p.evidence);
  } else {
    fact = { id: `bot-${p.category}-${p.q}-${p.country}-${p.typology}-${rows.length + 1}`.toLowerCase().replace(/[^a-z0-9-]/g, ""),
      category: p.category, q: p.q, country: p.country, typology: p.typology, en: p.en, value: p.value, evidence: [p.evidence], agree: true };
  }
  const disagree = rows.some(f => f.id !== fact!.id && f.review !== "rejected");
  for (const f of [fact, ...rows.filter(r => r.id !== fact!.id)]) {
    f.agree = !disagree;
    await env.DB.prepare(`INSERT INTO facts (id, category, q, country, typology, en, value, evidence, agree)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET evidence = ?8, agree = ?9, updated_at = CURRENT_TIMESTAMP`)
      .bind(f.id, f.category, f.q, f.country, f.typology, f.en, f.value, JSON.stringify(f.evidence), f.agree ? 1 : 0).run();
  }
  return { fact, created, confidence: confidence(fact.evidence, fact.agree !== false), status: status(fact) };
}

export async function list(env: Env, filter: { category?: string; country?: string; typology?: string } = {}): Promise<Fact[]> {
  const where: string[] = [], args: string[] = [];
  if (filter.category) { where.push(`category = ?${args.length + 1}`); args.push(filter.category); }
  if (filter.country) { where.push(`country IN (?${args.length + 1}, '*')`); args.push(filter.country); }
  if (filter.typology) { where.push(`typology IN (?${args.length + 1}, '*')`); args.push(filter.typology); }
  const sql = `SELECT * FROM facts ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY category, q`;
  return (await env.DB.prepare(sql).bind(...args).all<Row>()).results.map(fromRow);
}

/** The facts grouped like Keystone's facts/<category>.json files, with the sources they cite, for Keystone to merge */
export async function forKeystone(env: Env) {
  const facts = await list(env);
  const ids = [...new Set(facts.flatMap(f => f.evidence.map(e => e.source)))];
  const srcs = ids.length ? (await env.DB.prepare(`SELECT id, kind, title, author, url, year, country, typology, summary FROM sources
      WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`).bind(...ids).all()).results : [];
  const byCategory: Record<string, unknown[]> = {};
  for (const f of facts)
    (byCategory[f.category] ??= []).push({ id: f.id, q: f.q, country: f.country, typology: f.typology, en: f.en, value: f.value,
      evidence: f.evidence.map(e => ({ source: e.source, where: e.where })), target: f.target ?? "", agree: f.agree !== false,
      ...(f.review ? { review: f.review } : {}), confidence: confidence(f.evidence, f.agree !== false), status: status(f) });
  return { kinds: { video: { en: "Video", weight: kindWeight.video }, book: { en: "Book", weight: kindWeight.book } },
    sources: srcs, categories: Object.entries(byCategory).map(([category, facts]) => ({ category, facts })) };
}

interface Row { id: string; category: string; q: string; country: string; typology: string; en: string; value: string; target: string | null;
  evidence: string; agree: number; review: string | null }
const fromRow = (r: Row): Fact => ({ id: r.id, category: r.category, q: r.q, country: r.country, typology: r.typology, en: r.en,
  value: r.value, target: r.target ?? undefined, evidence: JSON.parse(r.evidence), agree: r.agree !== 0, review: r.review ?? undefined });
