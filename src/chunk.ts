// Text preprocessing shared by the ingest scripts and the Worker: cleaning transcripts and book pages, and cutting them into
// chunks that keep where they came from (a time window in a video, a page in a book), so every answer can cite it.

export interface Segment { start: number; duration: number; text: string }      // seconds, as caption tracks give them
export interface Page { page: number; text: string }
export interface Chunk { text: string; start?: number; end?: number; page?: number }

const NOISE = /\[(music|applause|laughter|musik|applaus|gelächter|inaudible|unverständlich)\]|\((music|applause|laughter)\)/gi;
const ENTITIES: Record<string, string> = { "&amp;": "&", "&quot;": '"', "&#39;": "'", "&lt;": "<", "&gt;": ">", "&nbsp;": " " };

/** Removes caption noise ([Music], >> speaker marks, HTML entities) and collapses whitespace. */
export function cleanText(text: string): string {
  return text
    .replace(/&(amp|quot|#39|lt|gt|nbsp);/g, m => ENTITIES[m] ?? m)
    .replace(NOISE, " ")
    .replace(/>>+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Book pages: joins words broken at the end of a line ("Gebäu-\nde") and drops running heads made only of digits. */
export function cleanPage(text: string): string {
  return cleanText(text.replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, "$1$2").replace(/^\s*\d+\s*$/gm, " "));
}

/**
 * Cuts a transcript into windows of about `window` seconds, each starting `window - overlap` seconds after the last,
 * so a sentence on a boundary is found from either side. Segments are never split, so a chunk's start is a real caption time.
 */
export function chunkTranscript(segments: Segment[], opts: { window?: number; overlap?: number } = {}): Chunk[] {
  const window = opts.window ?? 60, overlap = Math.min(opts.overlap ?? 15, (opts.window ?? 60) / 2);
  const segs = segments.map(s => ({ ...s, text: cleanText(s.text) })).filter(s => s.text.length > 0);
  const chunks: Chunk[] = [];
  let i = 0;
  while (i < segs.length) {
    const start = segs[i].start;
    let j = i, end = start;
    const parts: string[] = [];
    while (j < segs.length && (j === i || segs[j].start < start + window)) {
      parts.push(segs[j].text); end = segs[j].start + segs[j].duration; j++;
    }
    chunks.push({ text: parts.join(" "), start: round(start), end: round(end) });
    if (j >= segs.length) break;
    // the next window starts at the first segment inside the overlap, but always moves on by at least one segment
    let next = j;
    while (next - 1 > i && segs[next - 1].start >= start + window - overlap) next--;
    i = next;
  }
  return chunks;
}

/** Cuts book pages into chunks of at most `maxChars`, by paragraph and then by sentence; a chunk never spans two pages. */
export function chunkPages(pages: Page[], opts: { maxChars?: number } = {}): Chunk[] {
  const max = opts.maxChars ?? 1200;
  const chunks: Chunk[] = [];
  for (const p of pages) {
    const sentences = cleanPage(p.text).split(/(?<=[.!?:])\s+(?=\p{Lu}|\d)/u).filter(Boolean);
    let cur = "";
    for (const s of sentences) {
      if (cur && cur.length + s.length + 1 > max) { chunks.push({ text: cur, page: p.page }); cur = ""; }
      cur = cur ? `${cur} ${s}` : s.length > max ? s.slice(0, max) : s;
    }
    if (cur.length >= 40) chunks.push({ text: cur, page: p.page });      // a page with a caption only is not worth a vector
  }
  return chunks;
}

const round = (s: number) => Math.round(s * 10) / 10;

/** 75 → "1:15", 3723 → "1:02:03" */
export function timestamp(seconds: number): string {
  const s = Math.floor(seconds), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? h + ":" : ""}${mm}:${String(r).padStart(2, "0")}`;
}

/** The video's link starting at that second */
export function videoAt(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(seconds)}s`;
}

/** The 11-character id from any YouTube link form (watch, youtu.be, shorts, embed, live) or the id itself */
export function youtubeId(urlOrId: string): string | null {
  const m = urlOrId.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([A-Za-z0-9_-]{11})/) ?? urlOrId.match(/^([A-Za-z0-9_-]{11})$/);
  return m ? m[1] : null;
}
