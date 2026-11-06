// Adds precedents to the library: entries with pictures and the jury's written assessment of them, so the crit can compare
// the user's project with entries a real jury has judged.
//
//   npx tsx ingest/precedents.ts [ingest/precedents.json]
//
// The file lists each precedent (see precedents.example.json):
//   { "id": "hospital-2024-1", "title": "Hospital, 1st prize, 2024", "typology": "health", "country": "DE", "year": 2024,
//     "prize": "1st prize", "jury": "The jury's assessment …" or "juryFile": "texts/hospital.txt" (or a .pdf, with "juryPages": "3-4"),
//     "images": [{ "file": "boards/hospital-board-1.jpg", "label": "Perspective from the square", "crop": [0.5, 0, 0.5, 0.4] }],
//     "private": false }
// Pictures are read from your disk (only what you are allowed to use), cropped if "crop" is given as [left, top, width, height]
// in fractions of the picture (to cut one view out of a board), and downscaled to at most 1568 px, the size Claude reads best.
// Never put an office's or author's name in the title: the app names a precedent only by its label.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { slug } from "./book";

interface Item {
  id?: string; title: string; typology?: string; country?: string; year?: number; prize?: string; url?: string; lang?: string;
  jury?: string; juryFile?: string; juryPages?: string; private?: boolean;
  images?: { file: string; label?: string; crop?: [number, number, number, number] }[];
}

const MAX_SIDE = 1568, MAX_BYTES = 1_100_000;    // base64 adds a third: stays under the Worker's 1.5 MB per picture

/** One picture as a JPEG data URL: cropped, downscaled to MAX_SIDE, quality lowered until it fits */
export async function picture(file: string, crop?: [number, number, number, number]): Promise<string> {
  let img = sharp(await readFile(file), { limitInputPixels: false }).rotate();
  if (crop) {
    const { width = 0, height = 0 } = await img.metadata();
    const [l, t, w, h] = crop.map(x => Math.min(1, Math.max(0, x)));
    img = sharp(await img.toBuffer()).extract({ left: Math.round(l * width), top: Math.round(t * height),
      width: Math.max(1, Math.round(Math.min(w, 1 - l) * width)), height: Math.max(1, Math.round(Math.min(h, 1 - t) * height)) });
  }
  const base = await img.resize(MAX_SIDE, MAX_SIDE, { fit: "inside", withoutEnlargement: true }).toBuffer();
  for (const quality of [82, 70, 58, 45]) {
    const out = await sharp(base).jpeg({ quality, mozjpeg: true }).toBuffer();
    if (out.length <= MAX_BYTES || quality === 45) return `data:image/jpeg;base64,${out.toString("base64")}`;
  }
  throw new Error("unreachable");
}

async function juryText(item: Item, dir: string): Promise<string> {
  if (item.jury) return item.jury;
  if (!item.juryFile) throw new Error(`${item.title}: give "jury" (the text) or "juryFile"`);
  const file = resolve(dir, item.juryFile);
  if (!file.toLowerCase().endsWith(".pdf")) return readFile(file, "utf8");
  const pdf = await getDocument({ data: new Uint8Array(await readFile(file)), useSystemFonts: true }).promise;
  const [from, to] = (item.juryPages ?? `1-${pdf.numPages}`).split("-").map(Number);
  let text = "";
  for (let n = Math.max(1, from); n <= Math.min(pdf.numPages, to || from); n++)
    for (const it of (await (await pdf.getPage(n)).getTextContent()).items) if ("str" in it) text += it.str + (it.hasEOL ? "\n" : " ");
  if (!text.trim()) throw new Error(`${item.juryFile}: no text in this PDF, run OCR on it first`);
  return text;
}

async function send(item: Item, dir: string) {
  const base = process.env.JURY_URL ?? "http://localhost:8787", token = process.env.INGEST_TOKEN;
  if (!token) throw new Error("Set INGEST_TOKEN (the same secret as on the Worker)");
  const jury = (await juryText(item, dir)).replace(/\s+/g, " ").trim();
  const images = [];
  for (const im of (item.images ?? []).slice(0, 6))
    images.push({ label: im.label ?? "Lead image", url: await picture(resolve(dir, im.file), im.crop) });
  const precedent = { id: item.id ?? slug(item.title), title: item.title, typology: item.typology, country: item.country, year: item.year,
    prize: item.prize, url: item.url, language: item.lang, jury, private: item.private === true };
  const res = await fetch(`${base}/api/ingest/precedent`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ precedent, images }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${item.title}: ingest failed (${res.status}): ${JSON.stringify(body)}`);
  return body as { precedent: string; chunks: number; images: number };
}

async function main() {
  const file = process.argv[2] ?? "ingest/precedents.json";
  const raw = JSON.parse(await readFile(file, "utf8")) as { precedents?: Item[] } | Item[];
  const items = Array.isArray(raw) ? raw : raw.precedents ?? [];
  let failed = 0;
  for (const item of items) {
    try {
      const r = await send(item, dirname(resolve(file)));
      console.log(`${item.title}: ${r.chunks} chunk(s) of the jury's text, ${r.images} picture(s)${item.private ? " (private)" : ""}`);
    } catch (e) { failed++; console.error((e as Error).message); }
  }
  console.log(failed ? `${failed} precedent(s) failed` : `${items.length} precedent(s) ingested`);
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message); process.exit(1); });
