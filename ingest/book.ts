// Adds a book (a PDF) to the library: the text of each page, cut into chunks that keep their page number.
//
//   npx tsx ingest/book.ts --pdf path/to/book.pdf --author "Author" --title "Title" \
//     [--id short-slug] [--pages 12-240] [--offset 0] [--lang de] [--country DE] [--typology hospital] [--year 2019] [--url …]
//
// --offset: printed page = PDF page - offset, so the citations match the printed book.
// A scanned book without a text layer needs OCR first (e.g. ocrmypdf).
import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { Page } from "../src/chunk";
import type { Source } from "../src/types";
import { args, need, upload } from "./common";

export const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

async function main() {
  const a = args();
  need(a, "pdf", "author", "title");
  const pdf = await getDocument({ data: new Uint8Array(await readFile(a.pdf)), useSystemFonts: true }).promise;
  const [from, to] = (a.pages ?? `1-${pdf.numPages}`).split("-").map(Number);
  const offset = Number(a.offset ?? 0);
  const pages: Page[] = [];
  for (let n = Math.max(1, from); n <= Math.min(pdf.numPages, to || pdf.numPages); n++) {
    const content = await (await pdf.getPage(n)).getTextContent();
    let text = "";
    for (const item of content.items) if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    if (text.trim()) pages.push({ page: n - offset, text });
  }
  if (pages.length === 0) throw new Error("No text in this PDF: run OCR on it first");
  const source: Source = {
    id: a.id ?? slug(`${a.author.split(" ").at(-1)}-${a.title}`), kind: "book", title: a.title, author: a.author, url: a.url,
    language: a.lang, year: a.year ? Number(a.year) : undefined, country: a.country ?? "*", typology: a.typology ?? "*", summary: a.summary,
  };
  console.log(`${pages.length} pages with text`);
  const r = await upload(source, { pages });
  console.log(`${source.title}: ${r.chunks} chunks in the index`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
