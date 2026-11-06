import { timestamp, videoAt } from "./chunk";
import type { ChunkMeta } from "./types";

export interface Citation { chunkId: string; sourceId: string; kind: string; author: string; title: string; where: string; url?: string; quote: string; private?: boolean }

/** "12:34" for a video, "p. 56" for a book, "jury's assessment" for a precedent: the same text goes into a fact's evidence as `where` */
export function where(m: Pick<ChunkMeta, "kind" | "start" | "page">): string {
  return m.kind === "video" ? timestamp(m.start ?? 0) : m.kind === "precedent" ? "jury's assessment" : `p. ${m.page ?? "?"}`;
}

export function citation(chunkId: string, m: ChunkMeta, quoteChars = 280): Citation {
  const url = m.kind === "video" ? videoAt(m.sourceId, m.start ?? 0) : m.url;
  const quote = m.text.length > quoteChars ? m.text.slice(0, quoteChars).replace(/\s+\S*$/, "") + " …" : m.text;
  return { chunkId, sourceId: m.sourceId, kind: m.kind, author: m.author, title: m.title, where: where(m), url, quote, ...(m.private ? { private: true } : {}) };
}

/** How a passage is shown to the model: an id it can cite, the source, and the text */
export function forModel(c: Citation, text: string): string {
  return `[${c.chunkId}] ${c.author}, "${c.title}", ${c.where}\n${text}`;
}
