import { describe, expect, it, vi } from "vitest";

// the model and the index are faked: these tests check the jury's flow and what it keeps, not what Claude writes
const calls: string[] = [];
vi.mock("../src/llm", () => ({
  chatModel: () => ({
    withStructuredOutput: (_: unknown, { name }: { name: string }) => ({
      invoke: async (messages: { content: string }[]) => {
        calls.push(name);
        const who = /as (.+?)\. You speak|You are (.+?) in the second/.exec(messages[0].content);
        const me = who?.[1] ?? who?.[2] ?? "";
        const id = me === "Jan Gehl" ? "gehl:1" : "rossi:1";
        if (name === "crit") return { position: `${me}'s position`, verdict: "approve with changes", summary: "s",
          reasons: [
            { concept: "edges", stance: "praise", point: "p", passage: id, precedent: { building: "Strøget", passage: id } },
            { concept: "invented", stance: "concern", point: "p", passage: "nowhere:9" },
            { concept: "type", stance: "concern", point: "p", passage: id, precedent: { building: "made up", passage: "nowhere:1" } },
          ] };
        if (name === "replies") return { replies: [
          { to: me === "Jan Gehl" ? "Aldo Rossi" : "Jan Gehl", concept: "edges", response: "challenge", point: "r", passage: id },
          { to: "Somebody else", concept: "x", response: "agree", point: "r", passage: id },
        ] };
        if (name === "chair") return { verdict: "approve with changes", agree: ["a"], disagree: ["d"], next: ["n"], questions: ["q"],
          tensions: [{ question: "city or school?", sides: [{ juror: "Jan Gehl", view: "v" }, { juror: "Aldo Rossi", view: "w" }] }],
          reading: [{ passage: "gehl:1", why: "w" }, { passage: "nowhere:2", why: "w" }] };
        if (name === "questions") return { questions: [{ juror: "Jan Gehl", question: "For whom is the courtyard?", passage: "gehl:1" },
          { juror: "Jan Gehl", question: "made up", passage: "nowhere:3" }] };
        throw new Error(name);
      },
    }),
  }),
}));
vi.mock("../src/store", () => ({
  search: async (_env: unknown, _q: string, f: { author?: string }) => {
    const id = f.author === "Jan Gehl" ? "gehl" : f.author === "Aldo Rossi" ? "rossi" : null;
    return id ? [{ chunkId: `${id}:1`, sourceId: id, kind: "book", author: f.author, title: "T", where: "p. 1", quote: "q", text: "text", score: 1 }] : [];
  },
}));

const { jury, questions, grounded, brief } = await import("../src/jury");
const { inLibrary, positionsOf, sameAuthor } = await import("../src/positions");
const env = {} as never;
const project = { typology: "school", concept: "a courtyard school" };

describe("the theoretical crit", () => {
  it("runs jurors, a debate and the chair, and keeps only what is grounded", async () => {
    calls.length = 0;
    const r = await jury(env, { jurors: ["Jan Gehl", "Aldo Rossi"], project });
    expect(calls.sort()).toEqual(["chair", "crit", "crit", "replies", "replies"]);
    const gehl = r.jurors.find(j => j.juror === "Jan Gehl")!;
    expect(gehl.reasons.map(x => x.concept)).toEqual(["edges", "type"]);    // the invented passage is gone
    expect(gehl.reasons[0].precedent?.building).toBe("Strøget");
    expect(gehl.reasons[1].precedent).toBeUndefined();                       // a precedent on an unknown passage is dropped
    expect(gehl.dropped).toBe(1);
    expect(gehl.replies.map(x => x.to)).toEqual(["Aldo Rossi"]);             // a reply to someone not on the jury is dropped
    expect(gehl.passages.map(h => h.chunkId)).toEqual(["gehl:1"]);
    expect(r.chair?.tensions[0].sides).toHaveLength(2);
    expect(r.chair?.reading.map(h => h.chunkId)).toEqual(["gehl:1"]);      // reading only from passages the jurors had
  });

  it("skips the debate with one juror", async () => {
    calls.length = 0;
    await jury(env, { jurors: ["Jan Gehl"], project });
    expect(calls.sort()).toEqual(["chair", "crit"]);
  });

  it("asks the architect first, from the jurors' own passages", async () => {
    const q = await questions(env, { jurors: ["Jan Gehl"], project });
    expect(q).toEqual([{ juror: "Jan Gehl", question: "For whom is the courtyard?", passage: "gehl:1", where: "p. 1", title: "T" }]);
  });

  it("puts the architect's answers into what the jurors read", () => {
    const b = brief({ project, pitch: "open to the street", answers: [{ question: "For whom?", answer: "the neighbourhood" }, { question: "x", answer: " " }] });
    expect(b).toContain("THE ARCHITECT'S IDEA\nopen to the street");
    expect(b).toContain("Q: For whom?\nA: the neighbourhood");
    expect(b).not.toContain("Q: x");
  });

  it("grounded keeps a point whose precedent is unknown, without the precedent", () => {
    const r = grounded([{ concept: "c", stance: "praise", point: "p", passage: "a", precedent: { building: "b", passage: "z" } }], id => id === "a");
    expect(r).toEqual([{ concept: "c", stance: "praise", point: "p", passage: "a", precedent: undefined }]);
  });
});

describe("positions", () => {
  const library = ["Vitruvius", "John Ruskin", "Adolf Loos", "Aldo Rossi", "Christian Norberg-Schulz", "Jan Gehl", "Kevin Lynch",
    "Nikos A. Salingaros", "Bill Hillier", "Francis D.K. Ching", "Achim Menges", "Ernst Neufert"];

  it("matches authors however the library spells them", () => {
    expect(sameAuthor("Nikos Salingaros", "Nikos A. Salingaros")).toBe(true);
    expect(sameAuthor("Christian Norberg-Schulz", "C. Norberg-Schulz")).toBe(true);
    expect(sameAuthor("Aldo Rossi", "Aldo van Eyck")).toBe(false);
    expect(sameAuthor("Jan Gehl", "Ingrid Gehl")).toBe(false);
  });

  it("offers only positions with authors in the library", () => {
    const got = inLibrary(library);
    expect(got.find(p => p.id === "phenomenology")?.authors).toEqual(["Christian Norberg-Schulz"]);
    expect(got.find(p => p.id === "complexity")?.authors).toEqual(["Nikos A. Salingaros", "Bill Hillier"]);
    expect(got.some(p => p.id === "structuralism")).toBe(false);
    expect(positionsOf("Colin Rowe")).toEqual(["typology", "postmodern"]);
  });
});
