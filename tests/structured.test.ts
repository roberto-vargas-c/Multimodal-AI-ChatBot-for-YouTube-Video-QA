import { afterEach, describe, expect, it, vi } from "vitest";
import { chatModel } from "../src/llm";
import { ChairAnswer } from "../src/jury";

// The real LangChain path (ChatAnthropic.withStructuredOutput) against a stubbed Messages API: the reply the live jury got,
// a chair cut off by max_tokens after `disagree`
afterEach(() => vi.unstubAllGlobals());

describe("a structured answer cut short by max_tokens", () => {
  it("still parses, with the missing lists empty", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "max_tokens", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "tool_use", id: "tu_1", name: "chair", input: { verdict: "approve with changes", agree: ["a"], disagree: ["d"] } }],
      }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
    });
    const out = ChairAnswer.parse(await chatModel({ ANTHROPIC_API_KEY: "sk-test" } as never, { maxTokens: 8000 })
      .withStructuredOutput(ChairAnswer, { name: "chair" }).invoke("sum up"));
    expect(out).toMatchObject({ verdict: "approve with changes", agree: ["a"], tensions: [], questions: [], next: [], reading: [] });
    expect(sent).not.toHaveProperty("temperature");
    expect(sent.max_tokens).toBe(8000);
  });
});

describe("where a point applies", () => {
  it("is offered to the model, and a side Keystone cannot read is dropped without losing the answer", async () => {
    let sent: { tools?: { input_schema: unknown }[] } = {};
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(JSON.stringify({
        id: "msg_1", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "tool_use", stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
        content: [{ type: "tool_use", id: "tu_1", name: "chair", input: { verdict: "approve with changes", tensions: [
          { question: "q", sides: [], where: { side: "the courtyard", range: "ground" } }, { question: "r", sides: [], where: "everywhere" }] } }],
      }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_1" } });
    });
    const out = ChairAnswer.parse(await chatModel({ ANTHROPIC_API_KEY: "sk-test" } as never, { maxTokens: 8000 })
      .withStructuredOutput(ChairAnswer, { name: "chair" }).invoke("sum up"));
    expect(out.tensions.map(x => x.where)).toEqual([{ range: "ground" }, undefined]);
    expect(JSON.stringify(sent.tools?.[0].input_schema)).toContain("north-east");
  });
});
