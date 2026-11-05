// Evaluates the deployed assistant with LangSmith: each question in eval/dataset.jsonl goes to /api/ask, and five evaluators
// score the answer. Each run is one LangSmith experiment, so settings can be compared side by side (chunk size, model, k).
//
//   LANGSMITH_API_KEY=… ANTHROPIC_API_KEY=… JURY_URL=https://keystone-jury.….workers.dev npx tsx eval/run.ts [--name hybrid-k6]
//
// dataset.jsonl, one object per line:
//   { "question": "…", "answer": "the reference answer", "sources": [{ "id": "VIDEO_ID", "start": 754, "end": 820 }] }
//   { "question": "…", "answer": "…", "sources": [{ "id": "book-slug", "page": 56 }] }
//   { "question": "something the library cannot answer", "unanswerable": true }
import { readFile } from "node:fs/promises";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { args } from "../ingest/common";

interface Item { question: string; answer?: string; sources?: { id: string; start?: number; end?: number; page?: number }[]; unanswerable?: boolean; lang?: string }
interface Cited { sourceId: string; kind: string; where: string; url?: string }

const a = args();
const DATASET = a.dataset ?? "keystone-jury-qa", BASE = process.env.JURY_URL ?? "http://localhost:8787", SLACK = 30;   // seconds either side

const items: Item[] = (await readFile(a.file ?? "eval/dataset.jsonl", "utf8")).split("\n").filter(l => l.trim()).map(l => JSON.parse(l));
const client = new Client();
if (!(await client.hasDataset({ datasetName: DATASET }))) {
  await client.createDataset(DATASET, { description: "Questions about the Keystone jury's videos and books, with where the answer is" });
  await client.createExamples({ datasetName: DATASET, inputs: items.map(i => ({ question: i.question, lang: i.lang })),
    referenceOutputs: items.map(i => ({ answer: i.answer ?? null, sources: i.sources ?? [], unanswerable: !!i.unanswerable })) });
  console.log(`Created dataset ${DATASET} with ${items.length} examples`);
}

async function target(inputs: { question: string; lang?: string }) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}/api/ask`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: inputs.question, lang: inputs.lang, sessionId: `eval-${crypto.randomUUID()}`, allowWrites: false }) });
  const body = (await res.json()) as { answer?: string; citations?: Cited[]; tools?: string[]; error?: string };
  return { answer: body.answer ?? body.error ?? "", citations: body.citations ?? [], tools: body.tools ?? [], latency: (performance.now() - t0) / 1000 };
}

const seconds = (w: string) => w.split(":").map(Number).reduce((s, n) => s * 60 + n, 0);

/** Did a cited passage come from where the reference answer is: the same video within the time window, or the same book page */
function retrievalHit({ outputs, referenceOutputs }: { outputs: Record<string, any>; referenceOutputs?: Record<string, any> }) {
  const refs = (referenceOutputs?.sources ?? []) as NonNullable<Item["sources"]>;
  if (referenceOutputs?.unanswerable || refs.length === 0) return { key: "retrieval_hit", score: null as unknown as number };
  const hit = (outputs.citations as Cited[]).some(c => refs.some(r => r.id === c.sourceId && (c.kind === "video"
    ? r.start === undefined || (seconds(c.where) >= r.start - SLACK && seconds(c.where) <= (r.end ?? r.start) + SLACK)
    : r.page === undefined || c.where === `p. ${r.page}`)));
  return { key: "retrieval_hit", score: hit ? 1 : 0 };
}

/** Answers with a claim must cite; an unanswerable question must be declined without citations */
function grounded({ outputs, referenceOutputs }: { outputs: Record<string, any>; referenceOutputs?: Record<string, any> }) {
  const cites = (outputs.citations as Cited[]).length;
  return referenceOutputs?.unanswerable ? { key: "declined_unanswerable", score: cites === 0 ? 1 : 0 } : { key: "cites_sources", score: cites > 0 ? 1 : 0 };
}

const latency = ({ outputs }: { outputs: Record<string, any> }) => ({ key: "latency_s", score: Math.round(outputs.latency * 100) / 100 });
const usedSearch = ({ outputs }: { outputs: Record<string, any> }) => ({ key: "searched", score: (outputs.tools as string[]).includes("search_sources") ? 1 : 0 });

const judge = new ChatAnthropic({ model: process.env.JUDGE_MODEL ?? "claude-haiku-5-5", maxTokens: 300 })
  .withStructuredOutput(z.object({ score: z.number().min(0).max(1), reason: z.string() }), { name: "grade" });

/** LLM-as-judge: does the answer say what the reference says (or decline, for an unanswerable question)? */
async function correctness({ inputs, outputs, referenceOutputs }: { inputs: Record<string, any>; outputs: Record<string, any>; referenceOutputs?: Record<string, any> }) {
  const ref = referenceOutputs?.unanswerable ? "The library cannot answer this; a correct reply says so and invents nothing." : referenceOutputs?.answer;
  const g = await judge.invoke([
    { role: "system", content: "Grade an answer against a reference. 1 = same facts, nothing wrong added; 0.5 = partly right or missing a key point; 0 = wrong or invented. Ignore citation brackets and language." },
    { role: "user", content: `QUESTION\n${inputs.question}\n\nREFERENCE\n${ref}\n\nANSWER\n${outputs.answer}` },
  ]);
  return { key: "correctness", score: g.score, comment: g.reason };
}

const results = await evaluate(target, {
  data: DATASET,
  evaluators: [correctness, retrievalHit, grounded, usedSearch, latency],
  experimentPrefix: a.name ?? "keystone-jury",
  metadata: { url: BASE, note: a.note },
  maxConcurrency: 2,
});
console.log(`Done: ${results.experimentName}. Open it in LangSmith to compare with earlier runs.`);
