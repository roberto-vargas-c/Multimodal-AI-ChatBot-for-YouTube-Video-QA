import { CloudflareVectorizeStore, CloudflareWorkersAIEmbeddings } from "@langchain/cloudflare";
import { Document } from "@langchain/core/documents";
import type { VectorizeVectorMetadataFilter } from "@cloudflare/workers-types";
import type { Chunk } from "./chunk";
import { citation, type Citation } from "./citations";
import type { ChunkMeta, Env, Source } from "./types";

export function embeddings(env: Env) {
  return new CloudflareWorkersAIEmbeddings({ binding: env.AI, model: env.EMBEDDING_MODEL ?? "@cf/baai/bge-m3" });
}

/** The public index, or the owner-only one for private sources (copyrighted books) */
export function index(env: Env, priv = false) {
  if (!priv) return env.VECTORIZE;
  if (!env.VECTORIZE_PRIVATE) throw new Error("No private index: add the VECTORIZE_PRIVATE binding (see README)");
  return env.VECTORIZE_PRIVATE;
}

export function store(env: Env, priv = false) {
  return new CloudflareVectorizeStore(embeddings(env), { index: index(env, priv), textKey: "text" });
}

export const chunkId = (sourceId: string, index: number) => `${sourceId}:${index}`;

/** Embeds and stores a source's chunks (ids `<source>:<n>`, so ingesting a source again replaces it) and records the source. */
export async function ingest(env: Env, source: Source, chunks: Chunk[]): Promise<number> {
  const docs = chunks.map((c, index) => new Document<ChunkMeta>({
    pageContent: c.text,
    metadata: strip({ text: c.text, sourceId: source.id, kind: source.kind, author: source.author, title: source.title, index,
      start: c.start, end: c.end, page: c.page, url: source.url, country: source.country ?? "*", typology: source.typology ?? "*",
      private: source.private ? true : undefined }),
  }));
  const s = store(env, !!source.private);
  for (let i = 0; i < docs.length; i += 50)
    await s.addDocuments(docs.slice(i, i + 50), { ids: docs.slice(i, i + 50).map(d => chunkId(source.id, d.metadata.index)) });
  await env.DB.prepare(`INSERT INTO sources (id, kind, title, author, url, language, year, country, typology, summary, chunks, private)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
      ON CONFLICT(id) DO UPDATE SET kind = ?2, title = ?3, author = ?4, url = ?5, language = ?6, year = ?7, country = ?8,
        typology = ?9, summary = ?10, chunks = ?11, private = ?12, updated_at = CURRENT_TIMESTAMP`)
    .bind(source.id, source.kind, source.title, source.author, source.url ?? null, source.language ?? null, source.year ?? null,
      source.country ?? "*", source.typology ?? "*", source.summary ?? null, docs.length, source.private ? 1 : 0).run();
  return docs.length;
}

export interface SearchFilter { author?: string; kind?: string; sourceId?: string; typology?: string; country?: string }

export interface Hit extends Citation { text: string; score: number }

/**
 * Semantic search, filtered on the metadata Vectorize indexes (see README: create-metadata-index). The public index always;
 * the owner-only index too when `owner` is set (a request with OWNER_TOKEN or INGEST_TOKEN), merged by score.
 */
export async function search(env: Env, query: string, filter: SearchFilter = {}, k = 6, owner = false): Promise<Hit[]> {
  const f: VectorizeVectorMetadataFilter = {};
  for (const key of ["author", "kind", "sourceId", "typology", "country"] as const) if (filter[key]) f[key] = filter[key]!;
  const filt = Object.keys(f).length ? f : undefined;
  const both = owner && !!env.VECTORIZE_PRIVATE;
  const vector = await embeddings(env).embedQuery(query);
  const runs = await Promise.all([false, ...(both ? [true] : [])].map(priv =>
    store(env, priv).similaritySearchVectorWithScore(vector, k, filt)));
  return runs.flat().map(([doc, score]) => {
    const m = doc.metadata as ChunkMeta;
    return { ...citation(chunkId(m.sourceId, m.index), m), text: m.text ?? doc.pageContent, score };
  }).sort((a, b) => b.score - a.score).slice(0, k);
}

/** A chunk with the one before and after it, for when an answer needs more context than the hit itself */
export async function passage(env: Env, id: string, owner = false): Promise<Hit[]> {
  const [sourceId, n] = [id.slice(0, id.lastIndexOf(":")), Number(id.slice(id.lastIndexOf(":") + 1))];
  const ids = [n - 1, n, n + 1].filter(i => i >= 0).map(i => chunkId(sourceId, i));
  let vectors = await env.VECTORIZE.getByIds(ids);
  if (vectors.length === 0 && owner && env.VECTORIZE_PRIVATE) vectors = await env.VECTORIZE_PRIVATE.getByIds(ids);
  return vectors.filter(v => v.metadata).map(v => {
    const m = v.metadata as unknown as ChunkMeta;
    return { ...citation(v.id, m, 2000), text: m.text, score: 1 };
  });
}

/** The sources in the library; private ones only for the owner */
export async function sources(env: Env, owner = false): Promise<Source[]> {
  const { results } = await env.DB.prepare(`SELECT * FROM sources ${owner ? "" : "WHERE private = 0"} ORDER BY author, title`).all<Omit<Source, "private"> & { private: number }>();
  return results.map(s => ({ ...s, private: !!s.private }));
}

export async function authors(env: Env, owner = false): Promise<{ author: string; sources: number; kinds: string }[]> {
  const { results } = await env.DB.prepare(
    `SELECT author, COUNT(*) AS sources, GROUP_CONCAT(DISTINCT kind) AS kinds FROM sources ${owner ? "" : "WHERE private = 0"} GROUP BY author ORDER BY author`).all();
  return results as { author: string; sources: number; kinds: string }[];
}

const strip = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
