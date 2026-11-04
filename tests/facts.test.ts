import { describe, expect, it } from "vitest";
import { confidence, status } from "../src/facts";
import { isQuestion } from "../src/taxonomy";
import { routeByWords } from "../src/router";
import { toSeconds } from "../ingest/youtube";
import { queries } from "../src/jury";

describe("confidence, as in Keystone", () => {
  it("one video stays under review, a book and a video together apply", () => {
    const video = { source: "abc", where: "12:00", kind: "video" }, book = { source: "neufert", where: "p. 3", kind: "book" };
    expect(confidence([video])).toBe(0.25);
    expect(status({ evidence: [video] })).toBe("review");
    expect(confidence([video, book])).toBe(0.48);
    expect(confidence([video, book, { source: "def", where: "1:00", kind: "video" }])).toBe(0.61);
    expect(status({ evidence: [video, book, { source: "def", where: "1:00", kind: "video" }] })).toBe("applied");
  });
  it("counts a source once and lowers disagreeing facts", () => {
    const e = [{ source: "abc", where: "1:00", kind: "video" }, { source: "abc", where: "9:00", kind: "video" }];
    expect(confidence(e)).toBe(0.25);
    expect(confidence(e, false)).toBe(0.18);
  });
  it("a curator's review wins", () => {
    expect(status({ evidence: [], review: "confirmed" })).toBe("applied");
    expect(status({ evidence: [], review: "rejected" })).toBe("rejected");
  });
  it("knows Keystone's questions", () => {
    expect(isQuestion("boards", "format")).toBe(true);
    expect(isQuestion("boards", "colour")).toBe(false);
  });
});

describe("router", () => {
  it("sends questions to the agent and reviews to the jury", () => {
    expect(routeByWords("How deep should a hospital ward be?")).toBe("ask");
    expect(routeByWords("Wie tief ist ein Schulflur?")).toBe("ask");
    expect(routeByWords("Please judge my design")).toBe("jury");
    expect(routeByWords("Bewerte meinen Entwurf")).toBe("jury");
    expect(routeByWords("brick facade")).toBeNull();
  });
});

describe("ingest", () => {
  it("reads caption times in seconds or milliseconds", () => {
    expect(toSeconds([{ offset: 1.5, duration: 2, text: "a" }])[0].start).toBe(1.5);
    expect(toSeconds([{ offset: 0, duration: 2000, text: "a" }, { offset: 60000, duration: 2000, text: "b" }])[1].start).toBe(60);
  });
});

describe("jury", () => {
  it("searches the juror's work for the project's idea, facade, structure and site", () => {
    const q = queries({ typology: "school", facade: "brick", storeys: 3, concept: "learning clusters around a court" });
    expect(q).toHaveLength(4);
    expect(q[0]).toContain("learning clusters");
    expect(q[1]).toContain("brick");
  });
});
