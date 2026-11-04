// The jury: each juror is one author from the library. A juror reads the project, retrieves only from its own author's videos
// and books, and gives a verdict with reasons, each tied to a passage. A chair then sums up. The graph is
// START → jurors (in parallel) → chair → END, in LangGraph.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { chatModel } from "./llm";
import { search, type Hit } from "./store";
import { forModel } from "./citations";
import type { Env, ProjectSummary } from "./types";

const Verdict = z.enum(["approve", "approve with changes", "reject"]);

const JurorAnswer = z.object({
  verdict: Verdict,
  summary: z.string().describe("Two or three sentences in the juror's voice, about this project"),
  reasons: z.array(z.object({
    stance: z.enum(["praise", "concern"]),
    point: z.string().describe("One point about the project"),
    passage: z.string().describe("The id of the passage that grounds it, e.g. abc123:4"),
  })).min(1).max(5),
});

const ChairAnswer = z.object({
  verdict: Verdict,
  agree: z.array(z.string()).describe("Where the jurors agree"),
  disagree: z.array(z.string()).describe("Where they differ, naming who"),
  next: z.array(z.string()).max(4).describe("What to change in the design next"),
});

export type JurorResult = z.infer<typeof JurorAnswer> & { juror: string; passages: Hit[]; dropped: number };
export type JuryResult = { jurors: JurorResult[]; chair: z.infer<typeof ChairAnswer> | null };

export interface JuryInput { jurors: string[]; project: ProjectSummary; pitch?: string; lang?: string }

/** The searches a juror runs on its own author's work: the project's type and idea, its facade, its structure, its site */
export function queries(p: ProjectSummary, pitch?: string): string[] {
  const kind = [p.typology, p.style].filter(Boolean).join(", ");
  return [
    [kind, p.concept, pitch].filter(Boolean).join(". ") || "what makes a good building",
    `facade ${p.facade ?? ""} materials ${(p.materials ?? []).join(" ")}`.trim(),
    `structure ${p.structure ?? ""}, storeys ${p.storeys ?? ""}, density`.trim(),
    `site, open space, landscape ${p.landscape ?? ""}`.trim(),
  ];
}

async function judge(env: Env, juror: string, input: JuryInput): Promise<JurorResult> {
  const found = new Map<string, Hit>();
  for (const hits of await Promise.all(queries(input.project, input.pitch).map(q => search(env, q, { author: juror }, 4))))
    for (const h of hits) if (!found.has(h.chunkId)) found.set(h.chunkId, h);
  const passages = [...found.values()].sort((a, b) => b.score - a.score).slice(0, 10);
  if (passages.length === 0)
    return { juror, verdict: "approve with changes", summary: `There is nothing by ${juror} in the library to judge from.`, reasons: [], passages, dropped: 0 };

  const model = chatModel(env, { maxTokens: 1200, temperature: 0.3 }).withStructuredOutput(JurorAnswer, { name: "verdict" });
  const out = await model.invoke([
    { role: "system", content: [
      `You sit on an architecture competition jury as ${juror}. You judge only from the passages below, which are ${juror}'s own`,
      "words from lectures, talks and books. Stay faithful to them: do not claim views they do not express.",
      "Judge the project: approve, approve with changes, or reject. Give 2-5 reasons, each grounded in one passage id.",
      `Write in ${input.lang === "de" ? "German" : "English"}.`,
    ].join(" ") },
    { role: "user", content: `PROJECT\n${JSON.stringify(input.project, null, 1)}${input.pitch ? `\n\nPITCH\n${input.pitch}` : ""}\n\nPASSAGES\n` +
      passages.map(h => forModel(h, h.text)).join("\n\n") },
  ], { runName: `juror: ${juror}`, tags: ["jury", "juror"] });
  // a reason that cites a passage the juror was not given is dropped, so every reason the user sees is grounded
  const reasons = out.reasons.filter(r => found.has(r.passage));
  return { juror, ...out, reasons, passages: passages.filter(h => reasons.some(r => r.passage === h.chunkId)), dropped: out.reasons.length - reasons.length };
}

const State = Annotation.Root({
  input: Annotation<JuryInput>(),
  jurors: Annotation<JurorResult[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  chair: Annotation<JuryResult["chair"]>(),
});

export function juryGraph(env: Env) {
  return new StateGraph(State)
    .addNode("jurors", async s => ({ jurors: await Promise.all(s.input.jurors.map(j => judge(env, j, s.input))) }))
    .addNode("chair", async s => {
      const heard = s.jurors.filter(j => j.reasons.length > 0);
      if (heard.length === 0) return { chair: null };
      const model = chatModel(env, { maxTokens: 800 }).withStructuredOutput(ChairAnswer, { name: "chair" });
      const chair = await model.invoke([
        { role: "system", content: "You chair an architecture jury. Sum up the jurors' verdicts below: the overall verdict, where they agree, " +
          `where they differ (name them), and what to change next. Add nothing they did not say. Write in ${s.input.lang === "de" ? "German" : "English"}.` },
        { role: "user", content: heard.map(j => `${j.juror}: ${j.verdict}. ${j.summary}\n` +
          j.reasons.map(r => `- ${r.stance}: ${r.point}`).join("\n")).join("\n\n") },
      ], { runName: "chair", tags: ["jury", "chair"] });
      return { chair };
    })
    .addEdge(START, "jurors")
    .addEdge("jurors", "chair")
    .addEdge("chair", END)
    .compile();
}

export async function jury(env: Env, input: JuryInput): Promise<JuryResult> {
  const out = await juryGraph(env).invoke({ input }, { runName: "keystone-jury", tags: ["jury"] });
  return { jurors: out.jurors, chair: out.chair ?? null };
}
