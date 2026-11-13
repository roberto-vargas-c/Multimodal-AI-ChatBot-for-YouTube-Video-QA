// The jury: a theoretical crit of the open project. Each juror is one author from the library and speaks only from that
// author's own videos and books. The graph, in LangGraph:
//   START → jurors (in parallel) → debate (each answers the others) → chair → END
// A juror names the ideas they apply and reads the project through each one, with a passage for every point and, where the
// author gives one, a built precedent. In the debate the jurors answer each other. The chair does not average them: it sets
// out the tensions, the questions they leave the architect, and what to read next. Before all that the jury can ask the
// architect about their intentions (`questions`), and the answers go into the crit. Next to the views of the model the jurors
// see up to two precedents: entries a real jury has judged, with their lead picture and that jury's written assessment, and
// compare the project with them through their own concepts. Each juror also proposes up to three massing moves (moves.ts): concrete
// changes to the form, tied to a concept and a passage, which Keystone previews and applies where they map onto its operations.
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { chatModel } from "./llm";
import { search, type Hit } from "./store";
import { forModel } from "./citations";
import { position as findPosition } from "./positions";
import { findPrecedents, forModel as precedentText, type Shown } from "./precedents";
import { allMoves, cleanMoves, cleanWhere, MoveSchema, PLACE, PROPOSE, WhereSchema, type JurorMove, type Move } from "./moves";
import type { Env, ProjectSummary, View } from "./types";

const Verdict = z.enum(["approve", "approve with changes", "reject"]).default("approve with changes");

const Reading = z.object({
  concept: z.string().describe("The idea from the author's work, in their own terms, e.g. 'the in-between', 'genius loci', 'type'"),
  stance: z.enum(["praise", "concern"]).describe("praise: the project embodies the idea; concern: it misses or contradicts it"),
  point: z.string().describe("How the project shows or misses the idea, about this project specifically"),
  passage: z.string().describe("The id of the passage that grounds it, e.g. abc123:4"),
  precedent: z.object({
    building: z.string().describe("A built work the author uses for this idea, as the passage names it"),
    passage: z.string().describe("The id of the passage that names it"),
  }).optional().describe("Only when a passage names a built example of the idea"),
  where: WhereSchema.describe("The part of the building the point is about, only when it is about one part"),
});

export const JurorAnswer = z.object({
  position: z.string().default("").describe("The author's theoretical position in one or two sentences, in their own terms"),
  verdict: Verdict,
  summary: z.string().default("").describe("Two or three sentences in the juror's voice, about this project"),
  reasons: z.array(Reading).default([]).describe("2-5 readings"),
  comparisons: z.array(z.object({
    precedent: z.string().describe("The id of a precedent from the list"),
    point: z.string().describe("What the project does better, worse or differently than the precedent, in its picture and in what its jury praised or faulted, read through your concepts"),
  })).default([]).describe("Up to two, only when precedents are given"),
  moves: z.array(MoveSchema).default([]).describe("Up to three massing moves"),
});

const Replies = z.object({
  replies: z.array(z.object({
    to: z.string().describe("The juror answered"),
    concept: z.string().describe("The idea at stake"),
    response: z.enum(["agree", "challenge", "extend"]),
    point: z.string().describe("The reply, in the juror's voice"),
    passage: z.string().describe("The id of one of your own passages that grounds it"),
  })).default([]).describe("Up to three replies"),
});

export const ChairAnswer = z.object({
  verdict: Verdict,
  agree: z.array(z.string()).default([]).describe("Common ground: ideas the jurors share about this project, one or two sentences each"),
  disagree: z.array(z.string()).default([]).describe("Where they differ, naming who, one or two sentences each"),
  tensions: z.array(z.object({
    question: z.string().describe("The theoretical question at stake, e.g. 'Should the courtyard belong to the school or to the city?'"),
    sides: z.array(z.object({ juror: z.string(), view: z.string() })).default([]),
    where: WhereSchema.describe("The part of the building the tension is about, when the jurors' readings and moves place it there"),
  })).default([]).describe("Up to three: the real disagreements between positions, left open, not resolved"),
  questions: z.array(z.string()).default([]).describe("Up to three questions the crit leaves the architect to answer in the design"),
  next: z.array(z.string()).default([]).describe("Up to four things to explore in the design next"),
  reading: z.array(z.object({
    passage: z.string().describe("The id of a passage to read next"),
    why: z.string().describe("Why it would take the architect's thinking further"),
  })).default([]).describe("Up to four passages"),
});

// The image critic: reads the views of the model as drawings, not as a building. The criteria follow what drawing prizes publicly
// say they judge on (originality, the use of the medium, how well the image tells its intent, its impact), in our own words.
export const CRITERIA = ["originality", "medium", "intent", "impact"] as const;
export const DrawingAnswer = z.object({
  criteria: z.array(z.object({
    criterion: z.enum(CRITERIA),
    score: z.number().min(1).max(5).describe("1 weak … 5 outstanding"),
    point: z.string().describe("What in the pictures earns the score, concretely: which view, where in it"),
  })).default([]).describe("One per criterion"),
  summary: z.string().default("").describe("Two or three sentences: what the images say about the project, and what they fail to say"),
  improve: z.array(z.string()).default([]).describe("Up to three concrete changes to the views (viewpoint, light, people, line weight, crop, what to leave out)"),
});
export type Drawing = z.infer<typeof DrawingAnswer>;

const QuestionsAnswer = z.object({
  questions: z.array(z.object({
    juror: z.string(),
    question: z.string().describe("A question about the architect's intention, from the juror's own concerns"),
    passage: z.string().describe("The id of the passage it comes from"),
  })).default([]).describe("One or two per juror"),
});

type Reason = z.infer<typeof Reading>;
export type Reply = z.infer<typeof Replies>["replies"][number];
export type Comparison = z.infer<typeof JurorAnswer>["comparisons"][number];
export type JurorResult = Omit<z.infer<typeof JurorAnswer>, "reasons" | "comparisons" | "moves"> & { juror: string; reasons: Reason[]; comparisons: Comparison[]; moves: Move[]; replies: Reply[]; passages: Hit[]; dropped: number };
export type Chair = Omit<z.infer<typeof ChairAnswer>, "reading"> & { reading: (Hit & { why: string })[] };
export type JuryResult = { jurors: JurorResult[]; chair: Chair | null; moves: JurorMove[]; position?: string; precedents?: Shown[]; drawing?: Drawing };
export type Question = z.infer<typeof QuestionsAnswer>["questions"][number] & { where?: string; title?: string };

export interface Answer { question: string; answer: string }
export interface JuryInput {
  jurors: string[]; project: ProjectSummary; pitch?: string; lang?: string; owner?: boolean;
  position?: string;              // a school of thought from positions.ts: the jurors speak for it
  answers?: Answer[];             // the architect's answers to the jury's questions
  views?: View[];                 // rendered views of the model, which the jurors and the chair look at
  precedents?: Shown[];           // judged entries to compare with (found by jury() itself)
}

const language = (lang?: string) => lang === "de" ? "German" : "English";

/** The searches a juror runs on its own author's work: the project's type and idea, its facade, its structure, its site, precedents */
export function queries(p: ProjectSummary, pitch?: string): string[] {
  const kind = [p.typology, p.style].filter(Boolean).join(", ");
  return [
    [kind, p.concept, pitch].filter(Boolean).join(". ") || "what makes a good building",
    `facade ${p.facade ?? ""} materials ${(p.materials ?? []).join(" ")}`.trim(),
    `structure ${p.structure ?? ""}, storeys ${p.storeys ?? ""}, density`.trim(),
    ["site, street, open space, landscape", p.landscape, ...(p.context?.openSpace ?? []).slice(0, 2)].filter(Boolean).join(" ").slice(0, 300),
    ["ground floor, entrance, public life", ...(p.programme?.groundFloor ?? []).slice(0, 3).map(u => u.replace(/[\d.,]+\s*m²/g, "").trim())].join(" ").slice(0, 300),
    `built example, precedent, a building that shows this idea ${p.typology ?? ""}`.trim(),
  ];
}

/** What the jury reads: the project, its programme and site context, and the architect's own words (the pitch, the answers) */
export function brief(input: Pick<JuryInput, "project" | "pitch" | "answers" | "views" | "precedents">): string {
  const answers = (input.answers ?? []).filter(a => a.answer?.trim());
  const { programme, context, massing, ...project } = input.project ?? {};
  const views = input.views ?? [];
  return `PROJECT\n${JSON.stringify(project, null, 1)}` +
    (programme && Object.keys(programme).length ? `\n\nPROGRAMME (the rooms as the massing places them; groundFloor: the uses on the ground floor, largest first)\n${JSON.stringify(programme, null, 1)}` : "") +
    (massing && Object.keys(massing).length ? `\n\nMASSING (the form as built now; north is up; each side with its facade length and storeys)\n${JSON.stringify(massing, null, 1)}` : "") +
    (context && Object.keys(context).length ? `\n\nSITE CONTEXT (measured from the edge of the plot; north is up in the views)\n${JSON.stringify(context, null, 1)}` : "") +
    (views.length ? `\n\nVIEWS OF THE MODEL (attached): ${views.map((v, i) => `${i + 1}. ${v.label}`).join("; ")}` : "") +
    (input.precedents?.length ? `\n\nPRECEDENTS (entries a real competition jury has judged; their pictures are attached after the views)\n` +
      input.precedents.map((p, i) => precedentText(p, views.length + 1 + input.precedents!.slice(0, i).filter(x => x.image).length)).join("\n\n") : "") +
    (input.pitch ? `\n\nTHE ARCHITECT'S IDEA\n${input.pitch}` : "") +
    (answers.length ? `\n\nTHE ARCHITECT ANSWERED\n${answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join("\n")}` : "");
}

/** A user message with the views of the model in it, as images, then the precedents' pictures, before the text; just the text without any */
export function withViews(text: string, views: View[] = [], precedents: Shown[] = []): string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[] {
  const pics = [...views.map(v => ({ label: `View of the project: ${v.label}`, url: v.url })),
    ...precedents.flatMap(p => p.image ? [{ label: `Precedent [${p.id}] ${p.title}: ${p.image.label}`, url: p.image.url }] : [])];
  if (!pics.length) return text;
  return [...pics.flatMap((v, i) => [{ type: "text" as const, text: `Picture ${i + 1}. ${v.label}` }, { type: "image_url" as const, image_url: { url: v.url } }]),
    { type: "text" as const, text }];
}

/** Up to two pictures of the model: data URLs of a JPEG, PNG or WebP under 1.5 MB each; anything else is left out */
export function views(v: unknown): View[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const ok = (v as Record<string, unknown>[]).flatMap(x => {
    const url = typeof x?.url === "string" ? x.url : "";
    return url.length <= 1_500_000 && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(url)
      ? [{ label: String(x.label ?? "A view of the model").slice(0, 160), url }] : [];
  }).slice(0, 2);
  return ok.length ? ok : undefined;
}

// how a juror uses the precedents, when there are any
const COMPARE = "Where precedents are given, compare the project with up to two of them: look at their pictures next to the views," +
  " and weigh what their jury praised or faulted. Say through your own concepts what the project does better, worse or differently," +
  " citing the precedent's id. The precedents' jury is not you: never present its words as yours, and never name an office or author.";

// what every juror and the chair are told about the material beyond the figures
const LOOK = "Where the brief gives the programme with its ground floor uses, the site context or views of the model, read from them how the" +
  " building meets the street, what its ground floor offers the city and how it sits among its neighbours and open space, and say so" +
  " concretely. Do not invent what none of them shows.";

/** Keeps only what is grounded in a passage the juror was given; a precedent on an unknown passage is dropped, not the point */
export function grounded(reasons: Reason[], known: (id: string) => boolean): Reason[] {
  return reasons.filter(r => known(r.passage))
    .map(r => r.precedent && !known(r.precedent.passage) ? { ...r, precedent: undefined } : r);
}

async function gather(env: Env, juror: string, input: Pick<JuryInput, "project" | "pitch" | "owner">, k = 10): Promise<Hit[]> {
  const found = new Map<string, Hit>();
  for (const hits of await Promise.all(queries(input.project, input.pitch).map(q => search(env, q, { author: juror }, 4, !!input.owner))))
    for (const h of hits) if (!found.has(h.chunkId)) found.set(h.chunkId, h);
  return [...found.values()].sort((a, b) => b.score - a.score).slice(0, k);
}

const stance = (input: JuryInput) => {
  const p = findPosition(input.position);
  return p ? ` The crit is about ${p.en} (${p.idea}): speak to it as your own work argues it.` : "";
};

async function judge(env: Env, juror: string, input: JuryInput): Promise<JurorResult> {
  const passages = await gather(env, juror, input);
  const empty = { position: "", reasons: [], comparisons: [], moves: [], replies: [], passages, dropped: 0 };
  if (passages.length === 0)
    return { juror, verdict: "approve with changes", summary: `There is nothing by ${juror} in the library to judge from.`, ...empty };

  const model = chatModel(env, { maxTokens: 6000 }).withStructuredOutput(JurorAnswer, { name: "crit" });
  const out = JurorAnswer.parse(await model.invoke([
    { role: "system", content: [
      `You sit on a theoretical architecture crit as ${juror}. You speak only from the passages below, which are ${juror}'s own`,
      "words from lectures, talks and books. Stay faithful to them: do not claim views they do not express.", stance(input),
      "This is a discussion of ideas, not a score. State your position. Then name 2-5 concepts from your work and read the project",
      "through each: where it embodies the idea (praise) and where it misses or contradicts it (concern). Ground each in one passage id.",
      "Where a passage names a built work as an example of the idea, give it as the precedent with that passage id; never invent one.",
      "Take the architect's own words seriously: judge the project against what they say they want, too.", LOOK, COMPARE, PLACE, PROPOSE,
      `Still give an overall verdict. Write in ${language(input.lang)}.`,
    ].join(" ") },
    { role: "user", content: withViews(`${brief(input)}\n\nPASSAGES\n` + passages.map(h => forModel(h, h.text)).join("\n\n"), input.views, input.precedents) },
  ], { runName: `juror: ${juror}`, tags: ["jury", "juror"] }));
  // a reason that cites a passage the juror was not given is dropped, so every point the user sees is grounded
  const known = (id: string) => passages.some(h => h.chunkId === id);
  const reasons = grounded(out.reasons, known).slice(0, 5).map(r => ({ ...r, where: cleanWhere(r.where) }));
  const comparisons = out.comparisons.filter(c => input.precedents?.some(p => p.id === c.precedent)).slice(0, 2);
  const moves = cleanMoves(out.moves, known);
  return { juror, ...out, reasons, comparisons, moves, replies: [], passages, dropped: out.reasons.length - reasons.length };
}

/** The second round: a juror reads the others' readings and answers up to three of them, from their own passages */
async function reply(env: Env, me: JurorResult, others: JurorResult[], input: JuryInput): Promise<Reply[]> {
  if (!me.reasons.length || !others.some(o => o.reasons.length)) return [];
  const model = chatModel(env, { maxTokens: 4000 }).withStructuredOutput(Replies, { name: "replies" });
  const out = Replies.parse(await model.invoke([
    { role: "system", content: [
      `You are ${me.juror} in the second round of a theoretical architecture crit. You have heard the other jurors.`,
      "Answer up to three of their points: agree, challenge or extend them, from your own position and only from your own passages below.",
      "Look for real differences between the positions rather than politeness. Name the juror you answer.", stance(input),
      `Write in ${language(input.lang)}.`,
    ].join(" ") },
    { role: "user", content: `${brief(input)}\n\nYOUR POSITION\n${me.position}\n\nTHE OTHER JURORS\n` +
      others.filter(o => o.reasons.length).map(o => `${o.juror}: ${o.position}\n` + o.reasons.map(r => `- [${r.stance}] ${r.concept}: ${r.point}`).join("\n")).join("\n\n") +
      "\n\nYOUR PASSAGES\n" + me.passages.map(h => forModel(h, h.text)).join("\n\n") },
  ], { runName: `debate: ${me.juror}`, tags: ["jury", "debate"] }));
  const names = new Set(others.map(o => o.juror));
  return out.replies.filter(r => names.has(r.to) && me.passages.some(h => h.chunkId === r.passage)).slice(0, 3);
}

/** The image critic: one call that judges the views as images, only when there are views */
async function look(env: Env, input: JuryInput): Promise<Drawing | undefined> {
  if (!input.views?.length) return undefined;
  const model = chatModel(env, { maxTokens: 3000 }).withStructuredOutput(DrawingAnswer, { name: "drawing" });
  const out = DrawingAnswer.parse(await model.invoke([
    { role: "system", content: [
      "You judge architectural images as drawings, the way a drawing prize jury does, not the building's design.",
      "Score each criterion from 1 to 5 and say concretely what in the pictures earns it:",
      "originality (of approach, style or content); medium (how the technique and graphic quality are used: line, light, colour, composition);",
      "intent (how well the image communicates the architect's idea and the life of the place); impact (whether it would stop a jury at a wall of boards).",
      "Judge only what the views show, against the architect's idea in the brief. Be frank: rendered model views often score low on originality.",
      "Then up to three concrete changes to the views.", `Write in ${language(input.lang)}.`,
    ].join(" ") },
    { role: "user", content: withViews(brief({ ...input, precedents: undefined }), input.views) },
  ], { runName: "image critic", tags: ["jury", "drawing"] }));
  const seen = new Set<string>();
  return { ...out, criteria: out.criteria.filter(c => !seen.has(c.criterion) && seen.add(c.criterion)), improve: out.improve.slice(0, 3) };
}

const State = Annotation.Root({
  input: Annotation<JuryInput>(),
  drawing: Annotation<Drawing | undefined>(),
  jurors: Annotation<JurorResult[]>({ reducer: (_, b) => b, default: () => [] }),
  chair: Annotation<JuryResult["chair"]>(),
});

// where a point applies, as the chair reads it: " [north side, ground]"
const place = (w?: { side?: string; range?: string }) => w?.side || w?.range ? ` [${[w.side && `${w.side} side`, w.range && w.range !== "all" ? `${w.range} floors` : ""].filter(Boolean).join(", ")}]` : "";

/** What the chair reads: positions, readings and the debate, without the passages' text */
export function transcript(jurors: JurorResult[]): string {
  return jurors.filter(j => j.reasons.length).map(j => [
    `${j.juror}: ${j.position} Verdict: ${j.verdict}. ${j.summary}`,
    ...j.reasons.map(r => `- [${r.stance}] ${r.concept}${place(r.where)}: ${r.point}${r.precedent ? ` (precedent: ${r.precedent.building})` : ""}`),
    ...(j.comparisons ?? []).map(c => `- compared with [${c.precedent}]: ${c.point}`),
    ...(j.moves ?? []).map(m => `- proposes: ${m.title} (${m.concept}${place(m)}): ${m.why}`),
    ...j.replies.map(r => `- replies to ${r.to} (${r.response}, ${r.concept}): ${r.point}`),
  ].join("\n")).join("\n\n");
}

export function juryGraph(env: Env) {
  return new StateGraph(State)
    .addNode("hear", async s => {
      const [jurors, drawing] = await Promise.all([Promise.all(s.input.jurors.map(j => judge(env, j, s.input))), look(env, s.input).catch(() => undefined)]);
      return { jurors, drawing };
    })
    .addNode("debate", async s => ({
      jurors: await Promise.all(s.jurors.map(async j => ({ ...j, replies: await reply(env, j, s.jurors.filter(o => o !== j), s.input) }))),
    }))
    .addNode("sum_up", async s => {
      const heard = s.jurors.filter(j => j.reasons.length > 0);
      if (heard.length === 0) return { chair: null };
      const pool = new Map(heard.flatMap(j => j.passages).map(h => [h.chunkId, h]));
      const model = chatModel(env, { maxTokens: 8000 }).withStructuredOutput(ChairAnswer, { name: "chair" });
      const out = ChairAnswer.parse(await model.invoke([
        { role: "system", content: [
          "You chair a theoretical architecture crit. Do not average the jurors into one opinion. Set out the common ground,",
          "then the tensions: the real theoretical questions on which their positions pull apart, each side in the juror's terms, left open.",
          "Weigh the massing moves the jurors propose: where they pull in different directions, that is a tension.",
          "Where the readings and moves behind a tension are about one part of the building, say where it lies (side, floors).",
          "Then the questions the crit leaves the architect, what to explore next, and up to four passages from the list to read next,",
          "with why each would take the architect's thinking further. Add nothing the jurors did not say. Also give an overall verdict.",
          "Where the brief gives the programme, the site context or views, check what the jurors say against them.",
          `Write in ${language(s.input.lang)}.`,
        ].join(" ") },
        { role: "user", content: withViews(`${brief(s.input)}\n\nTHE CRIT\n${transcript(heard)}${s.drawing ? `\n\nTHE IMAGE CRITIC (on the views as drawings)\n${s.drawing.criteria.map(c => `- ${c.criterion} ${c.score}/5: ${c.point}`).join("\n")}\n${s.drawing.summary}` : ""}\n\nPASSAGES TO RECOMMEND\n` +
          [...pool.values()].map(h => `[${h.chunkId}] ${h.author}, "${h.title}", ${h.where}: ${h.text.slice(0, 200)}`).join("\n"), s.input.views, s.input.precedents) },
      ], { runName: "chair", tags: ["jury", "chair"] }));
      const reading = out.reading.flatMap(r => { const h = pool.get(r.passage); return h ? [{ ...h, why: r.why }] : []; }).slice(0, 4);
      return { chair: { ...out, tensions: out.tensions.filter(x => x.sides.length >= 2).slice(0, 3).map(x => ({ ...x, where: cleanWhere(x.where) })), questions: out.questions.slice(0, 3), next: out.next.slice(0, 4), reading } };
    })
    .addEdge(START, "hear")
    .addConditionalEdges("hear", s => s.jurors.filter(j => j.reasons.length).length > 1 ? "debate" : "sum_up", ["debate", "sum_up"])
    .addEdge("debate", "sum_up")
    .addEdge("sum_up", END)
    .compile();
}

export async function jury(env: Env, input: JuryInput): Promise<JuryResult> {
  const precedents = input.precedents ?? await findPrecedents(env, input.project, input.pitch, !!input.owner);
  input = { ...input, precedents };
  const out = await juryGraph(env).invoke({ input }, { runName: "keystone-jury", tags: ["jury"] });
  // the user is shown the passages a juror cited: for a reading, a precedent or a reply
  const jurors = out.jurors.map(j => {
    const cited = new Set([...j.reasons.flatMap(r => [r.passage, r.precedent?.passage]), ...j.replies.map(r => r.passage), ...j.moves.map(m => m.passage)]);
    return { ...j, passages: j.passages.filter(h => cited.has(h.chunkId)) };
  });
  // the precedents a juror compared the project with are shown with their picture
  const used = new Set(jurors.flatMap(j => j.comparisons.map(c => c.precedent)));
  const shown = precedents.filter(p => used.has(p.id));
  return { jurors, chair: out.chair ?? null, moves: allMoves(jurors), ...(input.position ? { position: input.position } : {}), ...(shown.length ? { precedents: shown } : {}),
    ...(out.drawing ? { drawing: out.drawing } : {}) };
}

/** Before the crit: each juror asks the architect about their intention, from what that juror cares about. One model call. */
export async function questions(env: Env, input: JuryInput): Promise<Question[]> {
  const found = await Promise.all(input.jurors.map(async j => ({ juror: j, passages: await gather(env, j, input, 5) })));
  const heard = found.filter(f => f.passages.length);
  if (!heard.length) return [];
  const model = chatModel(env, { maxTokens: 3000 }).withStructuredOutput(QuestionsAnswer, { name: "questions" });
  const out = QuestionsAnswer.parse(await model.invoke([
    { role: "system", content: [
      "Before a theoretical architecture crit, each juror below asks the architect one or two questions about their intentions,",
      "the kind that make them state a position: what the building wants to be, for whom, and how it meets the city and the site.",
      "Each question comes from that juror's own passages; give the passage id. Do not judge yet. Ask about what the project does not already say.",
      "Do not ask what the programme, the site context or the views of the model already answer.",
      stance(input), `Write in ${language(input.lang)}.`,
    ].join(" ") },
    { role: "user", content: withViews(`${brief(input)}\n\n` + heard.map(f => `JUROR ${f.juror}\n` + f.passages.map(h => forModel(h, h.text)).join("\n\n")).join("\n\n"), input.views) },
  ], { runName: "jury questions", tags: ["jury", "questions"] }));
  const all = new Map(heard.flatMap(f => f.passages).map(h => [h.chunkId, h]));
  return out.questions.flatMap(q => {
    const h = all.get(q.passage);
    return h && h.author === q.juror ? [{ ...q, where: h.where, title: h.title }] : h ? [{ ...q, juror: h.author, where: h.where, title: h.title }] : [];
  }).slice(0, 6);
}
