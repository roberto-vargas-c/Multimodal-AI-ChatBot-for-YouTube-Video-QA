// Shared by the ingest scripts: argument parsing, the Worker upload, and Whisper through the Workers AI REST API.
import { readFile } from "node:fs/promises";
import type { Segment } from "../src/chunk";
import type { Source } from "../src/types";

export function args(argv = process.argv.slice(2)): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { (out._ ??= argv[i]); continue; }
    const key = argv[i].slice(2), next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = "true"; else { out[key] = next; i++; }
  }
  return out;
}

export function need(a: Record<string, string>, ...keys: string[]) {
  const missing = keys.filter(k => !a[k]);
  if (missing.length) { console.error(`Missing --${missing.join(", --")}`); process.exit(1); }
}

/** Sends a source and its segments, pages or chunks to the Worker's /api/ingest (JURY_URL and INGEST_TOKEN in the environment) */
export async function upload(source: Source, payload: { segments?: Segment[]; pages?: { page: number; text: string }[]; chunks?: unknown[] }) {
  const base = process.env.JURY_URL ?? "http://localhost:8787", token = process.env.INGEST_TOKEN;
  if (!token) throw new Error("Set INGEST_TOKEN (the same secret as on the Worker)");
  const res = await fetch(`${base}/api/ingest`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ source, ...payload }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Ingest failed (${res.status}): ${JSON.stringify(body)}`);
  return body as { source: string; chunks: number };
}

/**
 * Whisper on an audio file, for videos without captions: download the audio yourself (yt-dlp -x --audio-format mp3 <url>),
 * then pass --audio. Uses the Workers AI REST API (CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN), which returns timed segments.
 * Files over ~20 MB must be split first (ffmpeg -f segment -segment_time 600); pass the parts in order, comma-separated.
 */
export async function whisper(files: string[], language?: string): Promise<Segment[]> {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID, token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !token) throw new Error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN for Whisper");
  const segments: Segment[] = [];
  let offset = 0;
  for (const file of files) {
    const audio = (await readFile(file)).toString("base64");
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/ai/run/@cf/openai/whisper-large-v3-turbo`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ audio, ...(language ? { language } : {}) }),
    });
    const body = (await res.json()) as { success: boolean; result?: { segments?: { start: number; end: number; text: string }[] }; errors?: unknown };
    if (!res.ok || !body.success) throw new Error(`Whisper failed on ${file}: ${JSON.stringify(body.errors)}`);
    const segs = body.result?.segments ?? [];
    for (const s of segs) segments.push({ start: offset + s.start, duration: s.end - s.start, text: s.text });
    offset += segs.length ? segs[segs.length - 1].end : 0;
  }
  return segments;
}
