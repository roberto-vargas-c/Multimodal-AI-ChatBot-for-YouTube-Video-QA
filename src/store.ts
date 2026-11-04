import { CloudflareVectorizeStore, CloudflareWorkersAIEmbeddings } from "@langchain/cloudflare";
import { Document } from "@langchain/core/documents";
import type { VectorizeVectorMetadataFilter } from "@cloudflare/workers-types";
import type { Chunk } from "./chunk";
import { citation, type Citation } from "./citations";
import type { ChunkMeta, Env, Source } from "./types";

export function embeddings(env: Env) {
  return new CloudflareWorkersAIEmbeddings({ binding: env.AI, model: env.EMBEDDING_MODEL ?? "@cf/baai/bge-m3" });
}

export function store(env: Env) {
  return new CloudflareVectorizeStore(embeddings(env), { index: env.VECTORIZE, textKey: "text" });
}

export const chunkId = (sourceId: string, index: number) => `${sourceId}:${index}`;

/** Embeds and stores a source's chunks (ids `<source>:<n>`, so ingesting a source again replaces it) and records the source. */
export async function ingest(env: Env, source: Source, chunks: Chunk[]): Promise<number> {
  const docs = chunks.map((c, index) => new Document<ChunkMeta>({
    pageContent: c.text,
    metadata: strip({ text: c.text, sourceId: source.id, kind: source.kind, author: source.author, title: source.title, index,
      start: c.start, end: c.end, page: c.page, url: source.url, country: source.country ?? "*", typology: source.typology ?? "*" }),
  }));
  const s = store(env);
  for (let i = 0; i < docs.length; i += 50)
    await s.addDocuments(docs.slice(i, i + 50), { ids: docs.slice(i, i + 50).map(d => chunkId(source.id, d.metadata.index)) });
  await env.DB.prepare(`INSERT INTO sources (id, kind, title, author, url, language, year, country, typology, summary, chunks)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
      ON CONFLICT(id) DO UPDATE SET kind = ?2, title = ?3, author = ?4, url = ?5, language = ?6, year = ?7, country = ?8,
        typology = ?9, summary = ?10, chunks = ?11, updated_at = CURRENT_TIMESTAMP`)
    .bind(source.id, source.kind, source.title, source.author, source.url ?? null, source.language ?? null, source.year ?? null,
      source.country ?? "*", source.typology ?? "*", source.summary ?? null, docs.length).run();
  return docs.length;
}

export interface SearchFilter { author?: string; kind?: string; sourceId?: string; typology?: string; country?: string }

export interface Hit extends Citation { text: string; score: number }

/** Semantic search over all chunks, filtered on the metadata Vectorize indexes (see README: create-metadata-index). */
export async function search(env: Env, query: string, filter: SearchFilter = {}, k = 6): Promise<Hit[]> {
  const f: VectorizeVectorMetadataFilter = {};
  for (const key of ["author", "kind", "sourceId", "typology", "country"] as const) if (filter[key]) f[key] = filter[key]!;
  const results = await store(env).similaritySearchWithScore(query, k, Object.keys(f).length ? f : undefined);
  return results.map(([doc, score]) => {
    const m = doc.metadata as ChunkMeta;
    return { ...citation(chunkId(m.sourceId, m.index), m), text: m.text ?? doc.pageContent, score };
  });
}

/** A chunk with the one before and after it, for when an answer needs more context than the hit itself */
export async function passage(env: Env, id: string): Promise<Hit[]> {
  const [sourceId, n] = [id.slice(0, id.lastIndexOf(":")), Number(id.slice(id.lastIndexOf(":") + 1))];
  const ids = [n - 1, n, n + 1].filter(i => i >= 0).map(i => chunkId(sourceId, i));
  const vectors = await env.VECTORIZE.getByIds(ids);
  return vectors.filter(v => v.metadata).map(v => {
    const m = v.metadata as unknown as ChunkMeta;
    return { ...citation(v.id, m, 2000), text: m.text, score: 1 };
  });
}

export async function sources(env: Env): Promise<Source[]> {
  const { results } = await env.DB.prepare("SELECT * FROM sources ORDER BY author, title").all<Source>();
  return results;
}

export async function authors(env: Env): Promise<{ author: string; sources: number; kinds: string }[]> {
  const { results } = await env.DB.prepare(
    "SELECT author, COUNT(*) AS sources, GROUP_CONCAT(DISTINCT kind) AS kinds FROM sources GROUP BY author ORDER BY author").all();
  return results as { author: string; sources: number; kinds: string }[];
}

const strip = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
