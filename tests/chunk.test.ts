import { describe, expect, it } from "vitest";
import { chunkPages, chunkTranscript, cleanPage, cleanText, timestamp, videoAt, youtubeId } from "../src/chunk";

const segs = (n: number, step = 5) => Array.from({ length: n }, (_, i) => ({ start: i * step, duration: step, text: `part ${i}.` }));

describe("cleaning", () => {
  it("drops caption noise and entities", () => {
    expect(cleanText("[Music] &gt;&gt; the court&#39;s  light [Applause]")).toBe("the court's light");
  });
  it("joins hyphenated words across lines and drops page numbers", () => {
    expect(cleanPage("Das Gebäu-\nde steht\n  42  \nam Platz")).toBe("Das Gebäude steht am Platz");
  });
});

describe("chunkTranscript", () => {
  it("cuts windows of about a minute that overlap", () => {
    const chunks = chunkTranscript(segs(48), { window: 60, overlap: 15 });           // 4 minutes
    expect(chunks[0].start).toBe(0);
    expect(chunks[0].end).toBe(60);
    expect(chunks[1].start).toBe(45);                                                   // 15 s of overlap
    expect(chunks.at(-1)!.end).toBe(240);
    for (let i = 1; i < chunks.length; i++) expect(chunks[i].start!).toBeGreaterThan(chunks[i - 1].start!);
  });
  it("covers every segment", () => {
    const text = chunkTranscript(segs(30)).map(c => c.text).join(" ");
    for (let i = 0; i < 30; i++) expect(text).toContain(`part ${i}.`);
  });
  it("moves on even when one segment is longer than the window", () => {
    const chunks = chunkTranscript([{ start: 0, duration: 200, text: "a long monologue" }, { start: 200, duration: 5, text: "end" }]);
    expect(chunks).toHaveLength(2);
  });
  it("skips empty and noise-only segments", () => {
    expect(chunkTranscript([{ start: 0, duration: 3, text: "[Music]" }])).toEqual([]);
  });
});

describe("chunkPages", () => {
  it("keeps the page of each chunk and never mixes pages", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is about courtyards.`).join(" ");
    const chunks = chunkPages([{ page: 12, text: long }, { page: 13, text: "A short page about the facade and its rhythm." }], { maxChars: 300 });
    expect(chunks.filter(c => c.page === 12).length).toBeGreaterThan(3);
    expect(chunks.every(c => c.text.length <= 300)).toBe(true);
    expect(chunks.at(-1)).toEqual({ text: "A short page about the facade and its rhythm.", page: 13 });
  });
  it("drops pages with almost no text", () => {
    expect(chunkPages([{ page: 1, text: "Fig. 3" }])).toEqual([]);
  });
});

describe("links and times", () => {
  it("formats timestamps", () => {
    expect(timestamp(75)).toBe("1:15");
    expect(timestamp(3723)).toBe("1:02:03");
    expect(videoAt("abcdefghijk", 75.6)).toBe("https://www.youtube.com/watch?v=abcdefghijk&t=75s");
  });
  it("reads YouTube ids from any link", () => {
    for (const u of ["https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10", "https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/shorts/dQw4w9WgXcQ", "dQw4w9WgXcQ"])
      expect(youtubeId(u)).toBe("dQw4w9WgXcQ");
    expect(youtubeId("https://example.com")).toBeNull();
  });
});
