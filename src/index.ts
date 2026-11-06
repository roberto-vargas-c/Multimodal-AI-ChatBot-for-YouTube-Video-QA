// The Worker: the HTTP API behind Keystone's Project › Jury. It has no page of its own: Keystone passes its panel's requests here.
import { awaitAllCallbacks } from "@langchain/core/callbacks/promises";
import type { ExecutionContext } from "@cloudflare/workers-types";
import { ask } from "./agent";
import { jury, questions, type Answer } from "./jury";
import { inLibrary, positionsOf, position } from "./positions";
import { route } from "./router";
import { MAX_AUDIO, transcribe } from "./speech";
import { allow } from "./llm";
import { ingest, sources, authors } from "./store";
import { forKeystone } from "./facts";
import { chunkPages, chunkTranscript, type Chunk, type Page, type Segment } from "./chunk";
import type { Env, ProjectSummary, Source } from "./types";

type Json = Record<string, unknown>;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    // the jury lives inside Keystone: anyone opening this address is sent to the panel there
    if (!url.pathname.startsWith("/api/")) return Response.redirect(`${(env.KEYSTONE_URL ?? "https://keystone.robert-en-var.workers.dev").replace(/\/$/, "")}/app#/project/jury`, 302);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    // a burst limit per address on the paid routes, before any work: requests over it are refused, never billed further
    if (request.method === "POST" && env.LIMITER && !isOwner(request, env)) {
      const { success } = await env.LIMITER.limit({ key: limitKey(request, env) });
      if (!success) return json({ error: "Too many requests. Please wait a minute and try again." }, 429, cors);
    }
    try {
      const res = await handle(request, url, env);
      for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
      return res;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(message);
      return json({ error: message }, e instanceof HttpError ? e.status : 500, cors);
    } finally {
      ctx.waitUntil(awaitAllCallbacks());       // let the LangSmith traces finish after the response
    }
  },
};

async function handle(request: Request, url: URL, env: Env): Promise<Response> {
  const path = url.pathname, method = request.method;

  if (path === "/api/health") return json({ ok: true, model: env.CHAT_MODEL ?? "claude-haiku-5-5", tracing: env.LANGSMITH_TRACING === "true" });
  const owner = isOwner(request, env);
  if (path === "/api/sources" && method === "GET") return json({ sources: await sources(env, owner) });
  if (path === "/api/authors" && method === "GET") {
    const list = await authors(env, owner);
    return json({ authors: list.map(a => ({ ...a, positions: positionsOf(a.author) })), positions: inLibrary(list.map(a => a.author)) });
  }
  if (path === "/api/facts" && method === "GET") return json(await forKeystone(env));

  if (path === "/api/transcribe" && method === "POST") {
    const audio = await request.arrayBuffer();
    if (audio.byteLength > MAX_AUDIO) throw new HttpError(413, "Recording too long: at most 5 MB");
    await budget(env);
    return json(await transcribe(env, audio, url.searchParams.get("lang") ?? undefined));
  }

  if (path === "/api/ask" && method === "POST") {
    const b = await body(request);
    await budget(env);
    const a = await ask(env, { ...askInput(b), owner });
    await allow(env, a.calls - 1);              // the agent's further model calls count too (up to RUN_LIMIT per question)
    return json({ route: "ask", ...a });
  }

  if (path === "/api/jury" && method === "POST") {
    const b = await body(request);
    let jurors = Array.isArray(b.jurors) ? (b.jurors as unknown[]).map(String).filter(Boolean).slice(0, 5) : [];
    const school = position(str(b.position));
    // a position alone calls up its authors from the library
    if (jurors.length === 0 && school) jurors = inLibrary((await authors(env, owner)).map(a => a.author)).find(p => p.id === school.id)?.authors.slice(0, 3) ?? [];
    if (jurors.length === 0) throw new HttpError(400, "Pick at least one juror (an author from /api/authors) or a position");
    const answers = Array.isArray(b.answers) ? (b.answers as Json[]).slice(0, 8).map(a => ({ question: String(a.question ?? ""), answer: String(a.answer ?? "") })) as Answer[] : undefined;
    const input = { jurors, project: (b.project ?? {}) as ProjectSummary, pitch: str(b.pitch), lang: str(b.lang), owner, position: school?.id, answers };
    // first the jury asks the architect about their intentions; then the crit, with the answers
    if (str(b.stage) === "questions") { await budget(env); return json({ route: "jury", jurors, questions: await questions(env, input) }); }
    await budget(env, jurors.length * 2 + 1);
    return json({ route: "jury", ...(await jury(env, input)) });
  }

  // one door for the panel: text or a transcript of speech, sent to the agent or to the jury
  if (path === "/api/chat" && method === "POST") {
    const b = await body(request);
    const message = str(b.message) ?? "";
    const mode = (str(b.mode) ?? "auto") as "auto" | "ask" | "jury";
    await budget(env);
    const r = mode === "auto" ? await route(env, message) : mode;
    if (r === "jury" && Array.isArray(b.jurors) && b.jurors.length) {
      await budget(env, b.jurors.length * 2 + 1);
      return json({ route: "jury", ...(await jury(env, { jurors: (b.jurors as unknown[]).map(String).slice(0, 5),
        project: (b.project ?? {}) as ProjectSummary, pitch: message, lang: str(b.lang), owner })) });
    }
    return json({ route: "ask", ...(await ask(env, { ...askInput(b), owner })) });
  }

  // the eval generator reads chunks by id (`<source>:<n>`) to write its test questions from them
  if (path === "/api/chunks" && method === "POST") {
    authorize(request, env);
    const ids = ((await body(request)).ids as unknown[] ?? []).map(String).slice(0, 20);
    const vectors = ids.length ? [...await env.VECTORIZE.getByIds(ids), ...(env.VECTORIZE_PRIVATE ? await env.VECTORIZE_PRIVATE.getByIds(ids) : [])] : [];
    return json({ chunks: vectors.filter(v => v.metadata).map(v => ({ id: v.id, ...(v.metadata as Json) })) });
  }

  // ingestion: the CLI in ingest/ sends a source with its transcript segments or book pages, or chunks it made itself
  if (path === "/api/ingest" && method === "POST") {
    authorize(request, env);
    const b = await body(request);
    const source = b.source as Source;
    if (!source?.id || !source.title || !source.author || !["video", "book"].includes(source.kind)) throw new HttpError(400, "source needs id, kind, title, author");
    const chunks: Chunk[] = Array.isArray(b.chunks) ? (b.chunks as Chunk[])
      : Array.isArray(b.segments) ? chunkTranscript(b.segments as Segment[])
      : Array.isArray(b.pages) ? chunkPages(b.pages as Page[]) : [];
    if (chunks.length === 0) throw new HttpError(400, "Nothing to ingest: send chunks, segments or pages");
    return json({ source: source.id, chunks: await ingest(env, source, chunks) });
  }

  throw new HttpError(404, "Not found");
}

function askInput(b: Json) {
  const message = str(b.message);
  if (!message) throw new HttpError(400, "message is required");
  return { sessionId: str(b.sessionId) ?? crypto.randomUUID(), message, project: b.project as ProjectSummary | undefined,
    lang: str(b.lang), allowWrites: b.allowWrites !== false };
}

async function budget(env: Env, calls = 1) {
  if (!(await allow(env, calls))) throw new HttpError(429, "The assistant has reached today's limit. Please try again tomorrow.");
}

/** Who a request counts against for the per-minute limit: Keystone forwards every visitor from its own address, so with the bot
 *  token it names the visitor (X-Keystone-Client); anyone else counts by the address they call from */
export function limitKey(request: Request, env: Env): string {
  const client = request.headers.get("x-keystone-client");
  if (client && env.KEYSTONE_BOT_TOKEN && env.KEYSTONE_BOT_TOKEN.length >= 16 && request.headers.get("x-keystone-bot") === env.KEYSTONE_BOT_TOKEN)
    return `keystone:${client}`;
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

/** The owner (OWNER_TOKEN or INGEST_TOKEN) also searches the private index; everyone else only the public one */
export function isOwner(request: Request, env: Env): boolean {
  const auth = request.headers.get("authorization") ?? "";
  return [env.OWNER_TOKEN, env.INGEST_TOKEN].some(t => !!t && t.length >= 16 && auth === `Bearer ${t}`);
}

function authorize(request: Request, env: Env) {
  if (!env.INGEST_TOKEN || request.headers.get("authorization") !== `Bearer ${env.INGEST_TOKEN}`) throw new HttpError(401, "Not allowed");
}

class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

async function body(request: Request): Promise<Json> {
  try { return (await request.json()) as Json; } catch { throw new HttpError(400, "Send JSON"); }
}

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });
}

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("origin") ?? "";
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map(s => s.trim()).filter(Boolean);
  const ok = allowed.includes("*") || allowed.includes(origin);
  return ok && origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type, authorization", "vary": "origin" } : {};
}
