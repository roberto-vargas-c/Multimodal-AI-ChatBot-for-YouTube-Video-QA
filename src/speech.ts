import type { Env } from "./types";

export const MAX_AUDIO = 5 * 1024 * 1024;

/** Speech to text with Whisper on Workers AI: the recording from the browser's microphone (webm, ogg, mp3, wav …). */
export async function transcribe(env: Env, audio: ArrayBuffer, language?: string): Promise<{ text: string; language?: string }> {
  if (audio.byteLength === 0) throw new Error("Empty recording");
  // Whisper on Workers AI is billed by the minute of audio: a spoken question from the microphone is far below this
  if (audio.byteLength > MAX_AUDIO) throw new Error("Recording too long: at most 5 MB");
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
