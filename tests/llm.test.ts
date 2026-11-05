import { describe, expect, it } from "vitest";
import { chatModel } from "../src/llm";

describe("the model request", () => {
  it("sends no sampling parameters, which current Claude models reject", () => {
    const p = chatModel({ ANTHROPIC_API_KEY: "x" } as never, { maxTokens: 900 }).invocationParams({}) as Record<string, unknown>;
    expect(p.model).toBe("claude-haiku-5-5");
    expect(p).not.toHaveProperty("temperature");
    expect(p).not.toHaveProperty("top_p");
    expect(p).not.toHaveProperty("top_k");
    expect(p.thinking).toBeUndefined();   // adaptive by default
  });
});
