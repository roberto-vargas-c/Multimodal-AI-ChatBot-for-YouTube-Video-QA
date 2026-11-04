import type { Env } from "./types";

/** Speech to text with Whisper on Workers AI: the recording from the browser's microphone (webm, ogg, mp3, wav …). */
export async function transcribe(env: Env, audio: ArrayBuffer, language?: string): Promise<{ text: string; language?: string }> {
  if (audio.byteLength === 0) throw new Error("Empty recording");
  if (audio.byteLength > 20 * 1024 * 1024) throw new Error("Recording too long: at most 20 MB");
  const model = env.WHISPER_MODEL ?? "@cf/openai/whisper-large-v3-turbo";
  const out = (await env.AI.run(model as never, { audio: base64(audio), ...(language ? { language } : {}), task: "transcribe" } as never)) as
    { text?: string; transcription_info?: { language?: string } };
  return { text: (out.text ?? "").trim(), language: out.transcription_info?.language };
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
