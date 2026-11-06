import type { Ai, D1Database, VectorizeIndex } from "@cloudflare/workers-types";

export interface Env {
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  VECTORIZE_PRIVATE?: VectorizeIndex;   // owner-only index (copyrighted books): only queried for owner requests
  DB: D1Database;
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> };   // Workers rate limiting binding (wrangler.jsonc ratelimits)
  ANTHROPIC_API_KEY: string;
  CHAT_MODEL?: string;             // default claude-haiku-5-5
  EMBEDDING_MODEL?: string;        // default @cf/baai/bge-m3 (multilingual, 1024 dimensions)
  WHISPER_MODEL?: string;          // default @cf/openai/whisper-large-v3-turbo
  INGEST_TOKEN?: string;           // Bearer token for POST /api/ingest
  OWNER_TOKEN?: string;            // Bearer token that also searches the private index (INGEST_TOKEN works too)
  ALLOWED_ORIGINS?: string;        // comma-separated, e.g. the Keystone app; "*" for the demo page anywhere
  AI_PER_DAY?: string;             // cap on paid model calls per day for the whole Worker (default 300)
  KEYSTONE_URL?: string;           // to read Keystone's own facts for lookup_facts
  KEYSTONE_BOT_TOKEN?: string;
  LANGSMITH_API_KEY?: string;
  LANGSMITH_TRACING?: string;
  LANGSMITH_PROJECT?: string;
}

export type SourceKind = "video" | "book";

/** One video or book. `id` is short and stable: the YouTube id, or a slug for a book. */
export interface Source {
  id: string;
  kind: SourceKind;
  title: string;
  author: string;                  // the lecturer or the book's author: the jury is made of these
  url?: string;
  language?: string;               // de, en …
  year?: number;
  country?: string;                // a Keystone country (DE, AT …) or "*"
  typology?: string;               // a Keystone building type or "*"
  summary?: string;
  private?: boolean;               // true: stored in the owner-only index, never shown to the public endpoints
}

/** What each vector carries in Vectorize next to its text */
export interface ChunkMeta {
  text: string;
  sourceId: string;
  kind: SourceKind;
  author: string;
  title: string;
  index: number;
  start?: number;
  end?: number;
  page?: number;
  url?: string;
  country?: string;
  typology?: string;
  private?: boolean;
}

/** What the Keystone panel sends about the open project (the browser already holds it, so no sign-in is needed here) */
export interface ProjectSummary {
  name?: string;
  typology?: string;
  country?: string;
  city?: string;
  site?: string;
  gfa?: number;
  storeys?: number;
  height?: number;
  grz?: number;
  gfz?: number;
  facade?: string;
  structure?: string;
  style?: string;
  materials?: string[];
  landscape?: string;
  concept?: string;                // the user's own words about the idea
  [key: string]: unknown;
}
