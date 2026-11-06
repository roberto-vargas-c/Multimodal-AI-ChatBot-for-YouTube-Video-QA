import { describe, expect, it } from "vitest";
import { modelCalls, RUN_LIMIT } from "../src/agent";
import { limitKey } from "../src/index";
import { MAX_AUDIO, transcribe } from "../src/speech";

describe("the day's budget", () => {
  it("counts every model turn of an agent run, at least one", () => {
    expect(modelCalls([{ type: "ai" }, { type: "tool" }, { type: "ai" }, { type: "tool" }, { type: "ai" }])).toBe(3);
    expect(modelCalls([{ getType: () => "ai" }, { getType: () => "tool" }])).toBe(1);
    expect(modelCalls([])).toBe(1);
    expect(RUN_LIMIT).toBe(6);
  });

  it("refuses long recordings before Whisper runs", async () => {
    const env = { AI: { run: () => { throw new Error("must not run"); } } } as never;
    await expect(transcribe(env, new ArrayBuffer(MAX_AUDIO + 1))).rejects.toThrow(/at most 5 MB/);
  });
});

describe("the per-minute limit", () => {
  const req = (h: Record<string, string>) => new Request("https://jury/api/ask", { method: "POST", headers: h });
  const env = { KEYSTONE_BOT_TOKEN: "0123456789abcdef" } as never;

  it("counts Keystone's visitors one by one when Keystone shows the bot token", () => {
    expect(limitKey(req({ "cf-connecting-ip": "1.1.1.1", "x-keystone-bot": "0123456789abcdef", "x-keystone-client": "9.9.9.9" }), env)).toBe("keystone:9.9.9.9");
  });

  it("ignores a named visitor without the right token", () => {
    expect(limitKey(req({ "cf-connecting-ip": "1.1.1.1", "x-keystone-bot": "wrong", "x-keystone-client": "9.9.9.9" }), env)).toBe("1.1.1.1");
    expect(limitKey(req({ "cf-connecting-ip": "1.1.1.1", "x-keystone-client": "9.9.9.9" }), {} as never)).toBe("1.1.1.1");
  });
});
