// Adds a YouTube video to the library: its captions (or Whisper on its audio), cut into timed chunks, embedded by the Worker.
//
//   npx tsx ingest/youtube.ts --url https://www.youtube.com/watch?v=… --author "Name of the lecturer" \
//     [--title "…"] [--lang de] [--country DE] [--typology school] [--year 2024] [--audio part1.mp3,part2.mp3]
//
// Run it on your own machine: YouTube often refuses caption requests from cloud servers.
import { YoutubeTranscript } from "youtube-transcript";
import { youtubeId, type Segment } from "../src/chunk";
import type { Source } from "../src/types";
import { args, need, upload, whisper } from "./common";

/** The caption library gives seconds for the classic format and milliseconds for srv3: whole numbers past 10 hours mean ms */
export function toSeconds(items: { offset: number; duration: number; text: string }[]): Segment[] {
  const ms = items.length > 0 && items.every(i => Number.isInteger(i.offset)) && Math.max(...items.map(i => i.offset)) > 36000;
  const k = ms ? 1 / 1000 : 1;
  return items.map(i => ({ start: i.offset * k, duration: i.duration * k, text: i.text }));
}

async function main() {
  const a = args();
  need(a, "url", "author");
  const id = youtubeId(a.url);
  if (!id) throw new Error(`Not a YouTube link: ${a.url}`);
  const meta = (await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${id}&format=json`)
    .then(r => (r.ok ? r.json() : {})).catch(() => ({}))) as { title?: string; author_name?: string };

  let segments: Segment[];
  if (a.audio) {
    segments = await whisper(a.audio.split(","), a.lang);
    console.log(`Whisper: ${segments.length} segments`);
  } else {
    try {
      segments = toSeconds(await YoutubeTranscript.fetchTranscript(id, a.lang ? { lang: a.lang } : undefined));
      console.log(`Captions: ${segments.length} segments`);
    } catch (e) {
      throw new Error(`No captions for ${id} (${(e as Error).message}). Download the audio with yt-dlp and pass --audio.`);
    }
  }

  const source: Source = {
    id, kind: "video", title: a.title ?? meta.title ?? id, author: a.author, url: `https://www.youtube.com/watch?v=${id}`,
    language: a.lang, year: a.year ? Number(a.year) : undefined, country: a.country ?? "*", typology: a.typology ?? "*",
    summary: a.summary ?? (meta.author_name ? `Channel: ${meta.author_name}` : undefined),
  };
  const r = await upload(source, { segments });
  console.log(`${source.title}: ${r.chunks} chunks in the index`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e.message); process.exit(1); });
