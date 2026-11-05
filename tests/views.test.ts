import { afterEach, describe, expect, it, vi } from "vitest";
import { chatModel } from "../src/llm";
import { brief, JurorAnswer, queries, views, withViews } from "../src/jury";

// The programme, the site context and the views of the model: what the jury reads and sees beyond the key figures
afterEach(() => vi.unstubAllGlobals());

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";
const project = {
  name: "Klinikum", typology: "health",
  programme: { netArea: 54485, groundFloor: ["Emergency department 4,210 m²", "Entrance and Magistrale 2,412 m²"] },
  context: { streets: ["Bergedorfer Straße (primary road), along the north side, 12 m"], openSpace: ["park, 40 m west"] },
};

describe("the views of the model", () => {
  it("keeps up to two image data URLs and leaves out anything else", () => {
    expect(views(undefined)).toBeUndefined();
    expect(views([{ url: "https://example.com/a.jpg" }, { url: "data:text/html;base64,PGI+" }, { url: 42 }])).toBeUndefined();
    const v = views([{ label: "Bird's eye", url: JPEG }, { url: JPEG }, { url: JPEG }]);
    expect(v).toHaveLength(2);
    expect(v![0].label).toBe("Bird's eye");
    expect(v![1].label).toBe("A view of the model");
    expect(views([{ url: "data:image/jpeg;base64," + "A".repeat(1_500_001) }])).toBeUndefined();
  });

  it("go before the text, each with its label; without views the message stays plain text", () => {
    expect(withViews("brief")).toBe("brief");
    const c = withViews("brief", [{ label: "Bird's eye", url: JPEG }]) as { type: string }[];
    expect(c.map(x => x.type)).toEqual(["text", "image_url", "text"]);
  });

  it("reach the Messages API as a base64 image next to the brief", async () => {
    let sent: { messages: { content: unknown }[] } = { messages: [] };
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "tool_use", id: "tu_1", name: "crit", input: { verdict: "approve", summary: "s", reasons: [] } }],
      }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
    });
    const input = { project, views: [{ label: "Bird's eye", url: JPEG }] };
    await chatModel({ ANTHROPIC_API_KEY: "sk-test" } as never, { maxTokens: 6000 }).withStructuredOutput(JurorAnswer, { name: "crit" })
      .invoke([{ role: "user", content: withViews(brief(input), input.views) }]);
    const blocks = sent.messages[0].content as Record<string, unknown>[];
    expect(blocks[1]).toEqual({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.split(",")[1] } });
    expect(blocks[2]).toMatchObject({ type: "text" });
    expect(String(blocks[2].text)).toContain("Bergedorfer Straße");
  });
});

describe("the brief", () => {
  it("sets out the programme, the site context and the views apart from the key figures", () => {
    const b = brief({ project, views: [{ label: "Bird's eye", url: JPEG }] });
    expect(b).toContain("PROGRAMME");
    expect(b).toContain("Emergency department 4,210 m²");
    expect(b).toContain("SITE CONTEXT");
    expect(b).toContain("park, 40 m west");
    expect(b).toContain("VIEWS OF THE MODEL (attached): 1. Bird's eye");
    expect(b.slice(0, b.indexOf("PROGRAMME"))).not.toContain("groundFloor");
  });

  it("stays as it was for a project without them", () => {
    expect(brief({ project: { name: "A" } })).toBe(`PROJECT\n${JSON.stringify({ name: "A" }, null, 1)}`);
  });

  it("searches each juror's work for the ground floor and the open space too", () => {
    const q = queries(project);
    expect(q.some(x => x.includes("ground floor") && x.includes("Emergency department") && !x.includes("4,210"))).toBe(true);
    expect(q.some(x => x.includes("park, 40 m west"))).toBe(true);
  });
});
