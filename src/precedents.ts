// Precedents: entries with pictures and the jury's written assessment of them, so the crit can look at the user's project next
// to entries a real jury has judged. The jury's text is embedded like a book page (kind "precedent"), so it is found by meaning;
// the pictures are kept in D1, already downscaled by the ingest script, and go to the model as images next to the views of the
// model. A precedent is named only by a neutral label: no office or author is stored or shown.
import { chunkPages } from "./chunk";
import { addChunks, search } from "./store";
import type { Env, Precedent, ProjectSummary, View } from "./types";

/** What the crit gets of a precedent: its label, the jury's words, and its lead picture */
export interface Shown {
  id: string; title: string; typology?: string; year?: number; prize?: string; url?: string;
  jury: string;                    // the jury's assessment, cut to what the model needs
  image?: View;                    // the lead picture, as a data URL
}

export const MAX_IMAGES = 6;
const IMAGE = /^data:(image\/(jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/;

/** The pictures that can be stored: data URLs of a JPEG, PNG or WebP under 1.5 MB, at most six; anything else is refused */
export function images(v: unknown): View[] {
  if (!Array.isArray(v)) return [];
  return (v as Record<string, unknown>[]).flatMap(x => {
    const url = typeof x?.url === "string" ? x.url : "";
    return url.length <= 1_500_000 && IMAGE.test(url) ? [{ label: String(x.label ?? "Lead image").slice(0, 160), url }] : [];
  }).slice(0, MAX_IMAGES);
}

/** Checks what the ingest script sends; throws a message the CLI can show */
export function precedent(v: unknown): Precedent {
  const p = (v ?? {}) as Record<string, unknown>;
  const s = (k: string) => typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string).trim() : undefined;
  const id = s("id"), title = s("title"), jury = s("jury");
  if (!id || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(id)) throw new Error("precedent.id: lower-case letters, digits and dashes");
  if (!title) throw new Error("precedent.title is required (a neutral label, e.g. \"Hospital, 1st prize, 2024\")");
  if (!jury || jury.length < 40) throw new Error("precedent.jury: the jury's written assessment is required");
  return { id, title, jury: jury.slice(0, 20_000), typology: s("typology") ?? "*", country: s("country") ?? "*",
    year: typeof p.year === "number" ? p.year : undefined, prize: s("prize"), url: s("url"), language: s("language"),
    private: p.private === true || undefined };
}

/** Stores a precedent: the jury's text into the index (kind "precedent"), the pictures into D1. Running it again replaces it. */
export async function ingestPrecedent(env: Env, p: Precedent, pics: View[]): Promise<{ chunks: number; images: number }> {
  const chunks = chunkPages([{ page: 1, text: p.jury }]);
  const n = await addChunks(env, { sourceId: p.id, kind: "precedent", author: "Competition jury", title: p.title, url: p.url,
    country: p.country, typology: p.typology, private: p.private }, chunks);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO precedents (id, title, typology, country, year, prize, url, jury, language, images, private)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET title = ?2, typology = ?3, country = ?4, year = ?5, prize = ?6, url = ?7, jury = ?8,
          language = ?9, images = ?10, private = ?11, updated_at = CURRENT_TIMESTAMP`)
      .bind(p.id, p.title, p.typology ?? "*", p.country ?? "*", p.year ?? null, p.prize ?? null, p.url ?? null, p.jury,
        p.language ?? null, pics.length, p.private ? 1 : 0),
    env.DB.prepare("DELETE FROM precedent_images WHERE precedent_id = ?1").bind(p.id),
    ...pics.map((img, i) => {
      const [, mime, , data] = IMAGE.exec(img.url)!;
      return env.DB.prepare("INSERT INTO precedent_images (precedent_id, n, label, mime, data) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(p.id, i, img.label, mime, data);
    }),
  ]);
  return { chunks: n, images: pics.length };
}

/** The precedents in the library, without their pictures; private ones only for the owner */
export async function listPrecedents(env: Env, owner = false) {
  const { results } = await env.DB.prepare(`SELECT id, title, typology, country, year, prize, url, images, private FROM precedents
      ${owner ? "" : "WHERE private = 0"} ORDER BY typology, year DESC`).all<Record<string, unknown>>();
  return results.map(r => ({ ...r, private: !!r.private }));
}

/** What the search for precedents asks: the kind of building, the idea, its look */
export function precedentQuery(p: ProjectSummary, pitch?: string): string {
  return [p.typology, p.style, p.concept, pitch, p.facade && `facade ${p.facade}`, (p.materials ?? []).join(" "), p.landscape]
    .filter(Boolean).join(". ").slice(0, 600) || "a good building";
}

/**
 * The precedents closest to the project: one search on the jury texts (no paid model call), the best `k` entries, each with its
 * lead picture. Precedents are optional: if anything fails, the crit goes on without them.
 */
export async function findPrecedents(env: Env, project: ProjectSummary, pitch?: string, owner = false, k = 2): Promise<Shown[]> {
  try {
    const hits = await search(env, precedentQuery(project, pitch), { kind: "precedent" }, 8, owner);
    const ids = [...new Set(hits.map(h => h.sourceId))].slice(0, k);
    if (!ids.length) return [];
    const shown: Shown[] = [];
    for (const id of ids) {
      const row = await env.DB.prepare("SELECT * FROM precedents WHERE id = ?1").bind(id).first<Record<string, unknown>>();
      if (!row || (row.private && !owner)) continue;
      const img = await env.DB.prepare("SELECT label, mime, data FROM precedent_images WHERE precedent_id = ?1 ORDER BY n LIMIT 1")
        .bind(id).first<{ label: string; mime: string; data: string }>();
      shown.push({ id, title: String(row.title), typology: row.typology as string, year: (row.year as number) ?? undefined,
        prize: (row.prize as string) ?? undefined, url: (row.url as string) ?? undefined, jury: cut(String(row.jury), 1800),
        ...(img ? { image: { label: img.label, url: `data:${img.mime};base64,${img.data}` } } : {}) });
    }
    return shown;
  } catch (e) {
    console.error(`precedents: ${e instanceof Error ? e.message : e}`);
    return [];
  }
}

/** How a precedent is shown to the model: an id it can cite, its label, and the jury's words */
export function forModel(p: Shown, n: number): string {
  return `[${p.id}] ${p.title}${p.prize ? `, ${p.prize}` : ""}${p.year ? `, ${p.year}` : ""}` +
    (p.image ? ` (picture ${n}: ${p.image.label})` : " (no picture)") + `\nTHE JURY WROTE: ${p.jury}`;
}

const cut = (s: string, n: number) => s.length > n ? s.slice(0, n).replace(/\s+\S*$/, "") + " …" : s;
