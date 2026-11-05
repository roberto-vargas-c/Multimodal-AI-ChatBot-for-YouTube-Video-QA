// Writes the evaluation questions so nobody has to: it reads passages spread over every video and book in the library,
// has Claude write one question and reference answer per passage, and adds questions the library cannot answer.
// The passage it came from is the reference source, so retrieval_hit checks the bot found the right minute or page.
//
//   JURY_URL=https://keystone-jury.….workers.dev INGEST_TOKEN=… ANTHROPIC_API_KEY=… npx tsx eval/generate.ts [--total 30] [--unanswerable 6]
//
// Then: npm run eval -- --dataset keystone-jury-qa-<date>   (a new dataset name each time the library changes)
import { writeFile } from "node:fs/promises";
import { ChatAnthropic } from "@langchain/anthropic";
import { z } from "zod";
import { args } from "../ingest/common";
import { share, spread } from "./pick";
import type { Source } from "../src/types";

const a = args();
const BASE = process.env.JURY_URL ?? "http://localhost:8787", TOKEN = process.env.INGEST_TOKEN;
const TOTAL = Number(a.total ?? 30), UNANSWERABLE = Number(a.unanswerable ?? 6), OUT = a.out ?? "eval/dataset.jsonl";
if (!TOKEN) throw new Error("Set INGEST_TOKEN (the same secret as on the Worker)");

interface Chunk { id: string; text: string; sourceId: string; kind: "video" | "book"; author: string; title: string; start?: number; end?: number; page?: number }

const { sources } = (await (await fetch(`${BASE}/api/sources`)).json()) as { sources: (Source & { chunks: number; language?: string })[] };
if (!sources.length) throw new Error("The library is empty: ingest some videos and books first");

const per = share(sources.map(s => s.chunks), TOTAL);
const ids = sources.flatMap((s, i) => spread(s.chunks, per[i]).map(n => `${s.id}:${n}`));
const chunks: Chunk[] = [];
for (let i = 0; i < ids.length; i += 20) {
  const res = await fetch(`${BASE}/api/chunks`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ ids: ids.slice(i, i + 20) }) });
  if (!res.ok) throw new Error(`Reading chunks failed (${res.status}): ${await res.text()}`);
  chunks.push(...((await res.json()) as { chunks: Chunk[] }).chunks);
}
console.log(`${chunks.length} passages from ${sources.length} sources`);

const model = new ChatAnthropic({ model: process.env.GEN_MODEL ?? "claude-haiku-5-5", maxTokens: 600 });

const QA = model.withStructuredOutput(z.object({
  usable: z.boolean().describe("false if the passage is an intro, credits, small talk or too vague to ask about"),
  question: z.string(), answer: z.string(),
}), { name: "write_test_question" });

const items: Record<string, unknown>[] = [];
for (const c of chunks) {
  const lang = sources.find(s => s.id === c.sourceId)?.language;
  const q = await QA.invoke([
    { role: "system", content: "You write test questions for an assistant that answers architects from a library of lectures and books. " +
      "Given one passage, write a question an architect could ask that this passage answers on its own, and the reference answer in one to three sentences, " +
      "using only what the passage says. The question names the author or the work when that helps, never 'the passage' or 'the video'. " +
      `Write both in ${lang?.startsWith("de") ? "German" : "English"}.` },
    { role: "user", content: `${c.author}, "${c.title}"\n\n${c.text}` },
  ]);
  if (!q.usable) continue;
  const where = c.kind === "video" ? { id: c.sourceId, start: Math.round(c.start ?? 0), end: Math.round(c.end ?? c.start ?? 0) } : { id: c.sourceId, page: c.page };
  items.push({ question: q.question, answer: q.answer, sources: [where], ...(lang ? { lang: lang.slice(0, 2) } : {}) });
}

// questions the library cannot answer: the bot should say so instead of inventing
const titles = sources.map(s => `${s.author}: ${s.title}`).join("\n");
const off = await model.withStructuredOutput(z.object({ questions: z.array(z.string()) }), { name: "write_unanswerable" }).invoke([
  { role: "system", content: `Write ${UNANSWERABLE} questions an architect might ask that none of these sources could answer: ` +
    "half about architecture topics far from them (a specific product price, a building code clause number, a recent event), half not about architecture at all. English." },
  { role: "user", content: titles },
]);
const none = off.questions.slice(0, UNANSWERABLE);
for (const q of none) items.push({ question: q, unanswerable: true });

await writeFile(OUT, items.map(i => JSON.stringify(i)).join("\n") + "\n");
console.log(`Wrote ${items.length} questions to ${OUT} (${items.length - none.length} from the library, ${none.length} it cannot answer)`);
