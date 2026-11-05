import { describe, expect, it } from "vitest";
import { images, precedent, precedentQuery, forModel } from "../src/precedents";
import { brief, withViews } from "../src/jury";
import { where } from "../src/citations";

// Precedents: pictures with a jury's written assessment, which the crit compares the project with
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

describe("precedents", () => {
  it("accept only image data URLs under 1.5 MB, at most six", () => {
    expect(images(undefined)).toEqual([]);
    expect(images([{ url: "https://example.com/a.jpg" }, { url: "data:text/html;base64,PGI+" }])).toEqual([]);
    expect(images(Array(8).fill({ url: JPEG }))).toHaveLength(6);
    expect(images([{ url: JPEG }])[0].label).toBe("Lead image");
    expect(images([{ url: "data:image/png;base64," + "A".repeat(1_500_001) }])).toEqual([]);
  });

  it("need an id, a neutral label and the jury's text", () => {
    const jury = "The jury praises the clear placing of the volume on the street and its generous yard.";
    expect(() => precedent({ title: "t", jury })).toThrow(/id/);
    expect(() => precedent({ id: "Bad Id", title: "t", jury })).toThrow(/id/);
    expect(() => precedent({ id: "a-1", jury })).toThrow(/title/);
    expect(() => precedent({ id: "a-1", title: "t", jury: "short" })).toThrow(/jury/);
    expect(precedent({ id: "a-1", title: "School, 2nd prize", jury, year: 2025, private: "yes" }))
      .toMatchObject({ id: "a-1", typology: "*", country: "*", year: 2025, private: undefined });
  });

  it("are searched by the project's type, idea and look", () => {
    expect(precedentQuery({ typology: "school", concept: "a courtyard school", materials: ["brick"] })).toBe("school. a courtyard school. brick");
    expect(precedentQuery({})).toBe("a good building");
  });

  it("are cited as the jury's assessment", () => {
    expect(where({ kind: "precedent" })).toBe("jury's assessment");
  });

  it("come after the views, numbered the same in the brief and in the pictures", () => {
    const views = [{ label: "Bird's eye", url: JPEG }, { label: "Plan", url: JPEG }];
    const precedents = [
      { id: "a-1", title: "School, 2nd prize", jury: "j", image: { label: "Lead image", url: JPEG } },
      { id: "b-2", title: "Hall", jury: "k" },
      { id: "c-3", title: "Library", jury: "l", image: { label: "Site plan", url: JPEG } },
    ];
    const c = withViews("brief", views, precedents) as { type: string; text?: string }[];
    expect(c.filter(x => x.type === "image_url")).toHaveLength(4);
    expect(c.filter(x => x.type === "text").map(x => x.text)).toEqual([
      "Picture 1. View of the project: Bird's eye", "Picture 2. View of the project: Plan",
      "Picture 3. Precedent [a-1] School, 2nd prize: Lead image", "Picture 4. Precedent [c-3] Library: Site plan", "brief"]);
    const b = brief({ project: {}, views, precedents });
    expect(b).toContain("[a-1] School, 2nd prize (picture 3: Lead image)\nTHE JURY WROTE: j");
    expect(b).toContain("[b-2] Hall (no picture)");
    expect(b).toContain("[c-3] Library (picture 4: Site plan)");
    expect(forModel(precedents[1], 0)).not.toMatch(/picture \d/);
    expect(withViews("only text", [], [{ id: "b-2", title: "Hall", jury: "k" }])).toBe("only text");
  });
});
