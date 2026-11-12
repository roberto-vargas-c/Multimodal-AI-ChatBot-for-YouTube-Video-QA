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
          ],
          comparisons: [{ precedent: "school-2025-2", point: "its yard opens to the street, this one turns away" }, { precedent: "made-up", point: "x" }],
          moves: [
            { title: "Lower the north wing by two floors", action: "step_back", side: "north", floors: 2, metres: 12, concept: "edges", why: "w", passage: id },
            { title: "Made up", action: "pull", side: "east", metres: 3, concept: "x", why: "w", passage: "nowhere:4" },
            { title: "Open the courtyard to the street", action: "other", side: "south", concept: "edges", why: "w", passage: id },
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
        if (name === "drawing") return { summary: "s", improve: ["a", "b", "c", "d"], criteria: [
          { criterion: "medium", score: 3, point: "flat light" }, { criterion: "medium", score: 5, point: "again" }, { criterion: "intent", score: 2, point: "no people" }] };
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

  it("returns the jurors' massing moves, grounded, once each, with who proposed them", async () => {
    const r = await jury(env, { jurors: ["Jan Gehl", "Aldo Rossi"], project });
    const gehl = r.jurors.find(j => j.juror === "Jan Gehl")!;
    expect(gehl.moves.map(m => m.title)).toEqual(["Lower the north wing by two floors", "Open the courtyard to the street"]);   // the ungrounded one is gone
    // both jurors propose the same two moves: the list keeps each once, from the first juror
    expect(r.moves.map(m => `${m.juror}: ${m.action} ${m.side}`)).toEqual(["Jan Gehl: step_back north", "Jan Gehl: other south"]);
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

  it("compares the project with precedents it was shown, and returns only those it compared", async () => {
    const shown = [
      { id: "school-2025-2", title: "Primary school, 2nd prize, 2025", jury: "The yard opens to the street.", image: { label: "Lead image", url: "data:image/jpeg;base64,AAAA" } },
      { id: "hall-2023-1", title: "Sports hall, 1st prize, 2023", jury: "A calm volume." },
    ];
    const r = await jury(env, { jurors: ["Jan Gehl"], project, precedents: shown });
    expect(r.jurors[0].comparisons.map(c => c.precedent)).toEqual(["school-2025-2"]);    // an unknown precedent is dropped
    expect(r.precedents?.map(p => p.id)).toEqual(["school-2025-2"]);
    const r2 = await jury(env, { jurors: ["Jan Gehl"], project, precedents: [] });
    expect(r2.jurors[0].comparisons).toEqual([]);
    expect(r2.precedents).toBeUndefined();
  });

  it("judges the views as drawings only when there are views", async () => {
    calls.length = 0;
    const r = await jury(env, { jurors: ["Jan Gehl"], project });
    expect(calls).not.toContain("drawing");
    expect(r.drawing).toBeUndefined();
    calls.length = 0;
    const v = await jury(env, { jurors: ["Jan Gehl"], project, precedents: [], views: [{ label: "Bird's eye", url: "data:image/jpeg;base64,AAAA" }] });
    expect(calls.sort()).toEqual(["chair", "crit", "drawing"]);
    expect(v.drawing?.criteria.map(c => `${c.criterion} ${c.score}`)).toEqual(["medium 3", "intent 2"]);   // one per criterion
    expect(v.drawing?.improve).toHaveLength(3);
  });

  it("goes on without precedents when none can be found", async () => {
    const r = await jury(env, { jurors: ["Jan Gehl"], project });
    expect(r.jurors[0].reasons.length).toBeGreaterThan(0);
    expect(r.precedents).toBeUndefined();
  });

  it("grounded keeps a point whose precedent is unknown, without the precedent", () => {
    const r = grounded([{ concept: "c", stance: "praise", point: "p", passage: "a", precedent: { building: "b", passage: "z" } }], id => id === "a");
    expect(r).toEqual([{ concept: "c", stance: "praise", point: "p", passage: "a", precedent: undefined }]);
  });
});

describe("massing moves", () => {
  const known = (id: string) => id === "a:1";
  const base = { concept: "c", why: "w", passage: "a:1" };
  it("keeps what Keystone can apply, and turns an incomplete move into text", async () => {
    const { cleanMoves } = await import("../src/moves");
    const r = cleanMoves([
      { ...base, title: "Two floors less", action: "remove_floors", floors: -2.4 },
      { ...base, title: "Pull the south face out", action: "pull", side: "south", metres: 400 },
      { ...base, title: "Push in somewhere", action: "push", metres: 3 },
      { ...base, title: "Step back", action: "step_back", side: "all", floors: 1, metres: 3 },
    ], known, 5);
    expect(r.map(m => [m.action, m.floors, m.metres])).toEqual([["remove_floors", 2, undefined], ["pull", undefined, 40], ["other", undefined, 3], ["other", 1, 3]]);
    expect(cleanMoves([{ ...base, title: "x", action: "other", passage: "b:1" }], known)).toEqual([]);
  });
  it("tells the jurors the massing", () => {
    const b = brief({ project: { ...project, massing: { form: "Bar", floors: 5, sides: { north: "60 m, 5 storeys" } } } });
    expect(b).toContain("MASSING");
    expect(b).toContain("60 m, 5 storeys");
    expect(b).not.toMatch(/PROJECT[^]*"massing"/);
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

  it("gives every Pritzker laureate in the library a school, seated in the position's order", () => {
    const laureates = ["Alejandro Aravena", "Arata Isozaki", "Balkrishna Doshi", "Christian de Portzamparc", "David Chipperfield",
      "Eduardo Souto de Moura", "Francis Kéré", "Frank Gehry", "Frei Otto", "Fumihiko Maki", "Glenn Murcutt", "Grafton Architects",
      "Jacques Herzog", "Jean Nouvel", "Lacaton & Vassal", "Liu Jiakun", "Norman Foster", "Paulo Mendes da Rocha", "Peter Zumthor",
      "RCR Arquitectes", "Rafael Moneo", "Rem Koolhaas", "Renzo Piano", "Richard Rogers", "Riken Yamamoto", "SANAA", "Shigeru Ban",
      "Smiljan Radić", "Tadao Ando", "Thom Mayne", "Toyo Ito", "Wang Shu", "Zaha Hadid", "Álvaro Siza"];
    for (const a of laureates) expect(positionsOf(a), a).toHaveLength(1);
    // the library lists authors alphabetically; a position seats the ones it names first
    expect(inLibrary(laureates).find(p => p.id === "social")?.authors.slice(0, 3)).toEqual(["Lacaton & Vassal", "Alejandro Aravena", "Balkrishna Doshi"]);
    expect(inLibrary([...laureates, "Peter Zumthor"]).find(p => p.id === "phenomenology")?.authors).toEqual(["Peter Zumthor", "Tadao Ando", "Álvaro Siza", "RCR Arquitectes"]);
  });
});

describe("answers the model cuts short", () => {
  it("a chair with only its first fields still parses, the rest empty", async () => {
    const { ChairAnswer, JurorAnswer } = await import("../src/jury");
    // the shape of the failure seen live: verdict, agree and disagree, nothing after
    const c = ChairAnswer.parse({ verdict: "approve with changes", agree: ["a"], disagree: ["d"] });
    expect(c).toMatchObject({ tensions: [], questions: [], next: [], reading: [] });
    expect(JurorAnswer.parse({}).reasons).toEqual([]);
    // more items than asked for are not an error either
    expect(ChairAnswer.parse({ questions: ["1", "2", "3", "4", "5"] }).questions).toHaveLength(5);
  });
});
