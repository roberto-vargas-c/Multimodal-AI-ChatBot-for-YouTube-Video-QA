// The Q&A agent: Claude with tools over the video and book index, the knowledge base and the open project, and a memory per
// session kept in D1. Every passage a tool hands the model gets an id; the answer cites those ids and the response lists them.
import { createAgent, modelCallLimitMiddleware, tool } from "langchain";
import { AIMessage, HumanMessage, type BaseMessage } from "@langchain/core/messages";
import { CloudflareD1MessageHistory } from "@langchain/cloudflare";
import { z } from "zod";
import { chatModel, text } from "./llm";
import { search, passage, sources, authors, type Hit } from "./store";
import { forModel } from "./citations";
import { list as listFacts, propose, confidence } from "./facts";
import { questionList, typologies, countries } from "./taxonomy";
import type { Env, ProjectSummary } from "./types";

const MEMORY = 12;   // messages of earlier turns the agent sees

export interface AskInput { sessionId: string; message: string; project?: ProjectSummary; lang?: string; allowWrites?: boolean }
export interface AskOutput { answer: string; citations: Hit[]; facts: unknown[]; tools: string[] }

function tools(env: Env, input: AskInput, seen: Map<string, Hit>, written: unknown[], used: string[]) {
  const remember = (hits: Hit[]) => { for (const h of hits) seen.set(h.chunkId, h); return hits; };
  const show = (hits: Hit[]) => hits.length ? hits.map(h => forModel(h, h.text)).join("\n\n") : "Nothing found.";
  const track = <T>(name: string, f: () => Promise<T>) => { used.push(name); return f(); };

  const searchSources = tool(
    ({ query, author, kind, typology }) => track("search_sources", async () =>
      show(remember(await search(env, query, { author, kind, typology }, 6)))),
    {
      name: "search_sources",
      description: "Semantic search over the transcripts of architecture videos (lectures, jury sessions, office talks) and the pages of " +
        "architecture books. Works across languages. Returns passages with an id like [abc123:4], the author, the title and a timestamp or page.",
      schema: z.object({
        query: z.string().describe("What to look for, in any language"),
        author: z.string().optional().describe("Only this author or lecturer, exactly as list_sources names them"),
        kind: z.enum(["video", "book"]).optional(),
        typology: z.enum(typologies as [string, ...string[]]).optional().describe("Only sources about this building type"),
      }),
    });

  const getPassage = tool(
    ({ id }) => track("get_passage", async () => show(remember(await passage(env, id)))),
    {
      name: "get_passage",
      description: "The full passage for an id from search_sources, with the passage before and after it, when a hit is cut off or needs context.",
      schema: z.object({ id: z.string().describe("A passage id such as abc123:4") }),
    });

  const listSources = tool(
    () => track("list_sources", async () => {
      const [all, people] = await Promise.all([sources(env), authors(env)]);
      return JSON.stringify({ authors: people, sources: all.map(s => ({ id: s.id, kind: s.kind, title: s.title, author: s.author, year: s.year })) });
    }),
    { name: "list_sources", description: "The videos and books in the index and their authors.", schema: z.object({}) });

  const lookupFacts = tool(
    ({ category, country, typology }) => track("lookup_facts", async () => {
      const facts = await listFacts(env, { category, country, typology });
      const own = facts.map(f => ({ id: f.id, category: f.category, q: f.q, country: f.country, typology: f.typology, en: f.en, value: f.value,
        confidence: confidence(f.evidence, f.agree !== false), evidence: f.evidence.map(e => `${e.source} ${e.where}`) }));
      const keystone = env.KEYSTONE_URL && env.KEYSTONE_BOT_TOKEN && country && typology
        ? await fetch(`${env.KEYSTONE_URL}/api/knowledge/activate?country=${country}&typology=${typology}`,
            { headers: { authorization: `Bearer ${env.KEYSTONE_BOT_TOKEN}` } }).then(r => (r.ok ? r.json() : null)).catch(() => null)
        : null;
      return JSON.stringify({ written_by_this_assistant: own, keystone });
    }),
    {
      name: "lookup_facts",
      description: "What Keystone's knowledge base already holds: design rules per category, country and building type, with their confidence.",
      schema: z.object({
        category: z.string().optional(),
        country: z.enum(countries as [string, ...string[]]).optional(),
        typology: z.enum(typologies as [string, ...string[]]).optional(),
      }),
    });

  const getProject = tool(
    () => track("get_project", async () => input.project ? JSON.stringify(input.project) : "No project is open."),
    { name: "get_project", description: "The project open in Keystone: building type, country, area, storeys, facade, structure, style, concept.", schema: z.object({}) });

  const proposeFact = tool(
    ({ category, q, country, typology, en, value, passage: id }) => track("propose_fact", async () => {
      if (input.allowWrites === false) return "Writing to the knowledge base is switched off for this conversation.";
      const hit = seen.get(id);
      if (!hit) return `Passage ${id} was not retrieved in this conversation; search for it first.`;
      const r = await propose(env, { category, q, country, typology, en, value,
        evidence: { source: hit.sourceId, where: hit.where, kind: hit.kind, quote: hit.quote } });
      written.push({ id: r.fact.id, en: r.fact.en, value: r.fact.value, created: r.created, confidence: r.confidence, status: r.status });
      return JSON.stringify({ saved: r.fact.id, created: r.created, confidence: r.confidence, status: r.status });
    }),
    {
      name: "propose_fact",
      description: "Write a design rule into Keystone's knowledge base, backed by one passage you retrieved. Use it only when a passage states " +
        "a clear, general rule that answers one of these questions (category: question ids):\n" + questionList() +
        "\nOne source stays under Needs review; the same answer from a second source raises its confidence.",
      schema: z.object({
        category: z.string(), q: z.string().describe("The question id within the category"),
        country: z.enum(countries as [string, ...string[]]).describe("The country the rule holds for, * when general"),
        typology: z.enum(["*", ...typologies] as [string, ...string[]]).describe("The building type, * for all"),
        en: z.string().describe("The rule as one short English sentence"),
        value: z.string().describe("The answer in a few words, e.g. '15-16 m deep' or 'A0, landscape'"),
        passage: z.string().describe("The id of the passage that states it"),
      }),
    });

  return [searchSources, getPassage, listSources, lookupFacts, getProject, proposeFact];
}

function systemPrompt(input: AskInput): string {
  return [
    "You are the jury assistant of Keystone, an app that designs buildings. You answer questions about architecture from a library of",
    "video transcripts (lectures, competition jury sessions, office talks) and books, using your tools.",
    "- Search before you answer. Answer only from the passages you retrieved; if they do not answer the question, say so plainly.",
    "- Cite every claim with the passage id in square brackets, like [abc123:4]. Never invent an id.",
    "- Name who said it: the author and the video or book.",
    "- When the question is about the user's design, call get_project first.",
    "- When a passage states a clear, general design rule that Keystone's knowledge base lacks, you may save it with propose_fact,",
    "  and say that you did.",
    `- Answer in the language of the question${input.lang ? ` (the app is set to ${input.lang})` : ""}. Keep it short: a few sentences or bullets.`,
  ].join("\n");
}

export async function ask(env: Env, input: AskInput): Promise<AskOutput> {
  const memory = new CloudflareD1MessageHistory({ tableName: "messages", sessionId: input.sessionId, database: env.DB });
  const history: BaseMessage[] = (await memory.getMessages()).slice(-MEMORY);
  const seen = new Map<string, Hit>(), written: unknown[] = [], used: string[] = [];
  const agent = createAgent({
    model: chatModel(env),
    tools: tools(env, input, seen, written, used),
    systemPrompt: systemPrompt(input),
    middleware: [modelCallLimitMiddleware({ runLimit: 6, exitBehavior: "end" })],
  });
  const result = await agent.invoke({ messages: [...history, new HumanMessage(input.message)] },
    { runName: "keystone-jury-ask", metadata: { sessionId: input.sessionId }, tags: ["ask"] });
  const answer = text(result.messages.at(-1)?.content).trim() || "I could not find an answer in the videos and books.";
  await memory.addMessages([new HumanMessage(input.message), new AIMessage(answer)]);
  const cited = [...answer.matchAll(/\[([^\]\s]+:\d+)\]/g)].map(m => m[1]);
  const citations = [...new Set(cited)].map(id => seen.get(id)).filter((h): h is Hit => !!h);
  return { answer, citations, facts: written, tools: used };
}
