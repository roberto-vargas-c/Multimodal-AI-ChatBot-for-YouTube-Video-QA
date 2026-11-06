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

export type SourceKind = "video" | "book" | "precedent";   // precedent: a jury's written assessment of an entry (see precedents.ts)

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
  programme?: Programme;           // the room programme and what the ground floor holds
  context?: SiteContext;           // what is around the site: streets, neighbours, open space
  massing?: MassingSummary;        // the form as built now, side by side, so the jury can propose moves on it
  [key: string]: unknown;
}

/** The room programme as the massing places it: the uses with their floors, and the uses on the ground floor */
export interface Programme {
  netArea?: number;
  rooms?: number;
  uses?: { use: string; floors?: string; zone?: string; net?: number; rooms?: number }[];
  groundFloor?: string[];          // "Emergency department 4,210 m²", largest first
  largestRooms?: string[];
  buildings?: string[];            // a masterplan: each building with its storeys, area and uses
  entrances?: string[];
  notes?: string;
  [key: string]: unknown;
}

/** The form as Keystone builds it now: its kind, floors and size, and each side (north up) with its facade and storeys */
export interface MassingSummary {
  form?: string;                   // "Courtyard block", "Bar", "Custom shape" …
  floors?: number;
  height?: number;
  footprint?: string;              // "62 × 38 m, 2,356 m²"
  courts?: number;
  sides?: Record<string, string>;  // north: "62 m of facade, 6 storeys (21 m)"
  buildings?: string[];            // a masterplan: each building with where it stands on the plot
  editable?: string[];             // the moves Keystone can preview and apply on this project
  [key: string]: unknown;
}

/** The site's surroundings, measured from the plot: each with its distance and the side of the plot it lies on */
export interface SiteContext {
  plot?: string;
  streets?: string[];
  neighbours?: string;
  closest?: string[];
  openSpace?: string[];
  trees?: string;
  notes?: string;
  [key: string]: unknown;
}

/** A picture of the model the jury looks at: a data URL (JPEG, PNG or WebP) and what it shows */
export interface View { label: string; url: string }

/** A precedent: an entry (a competition entry, a built work) with its pictures and the jury's written assessment of it.
 *  It is named by a neutral label only: no office or author is kept. */
export interface Precedent {
  id: string;
  title: string;                   // a neutral label, e.g. "Hospital, 1st prize, 2024"
  jury: string;                    // the jury's written assessment, as published
  typology?: string;
  country?: string;
  year?: number;
  prize?: string;
  url?: string;
  language?: string;
  private?: boolean;               // true: only owner requests use it (as with private books)
}
