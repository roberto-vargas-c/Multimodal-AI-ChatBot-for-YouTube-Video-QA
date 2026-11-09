import { describe, expect, it } from "vitest";
import { modelCalls, RUN_LIMIT } from "../src/agent";
import { limitKey } from "../src/index";
import { MAX_AUDIO, transcribe } from "../src/speech";
import { spend, usage, limitMessage, nextReset, capOf } from "../src/llm";

/** Just enough of D1 for the usage table: one counter per day */
function fakeDb() {
  const days = new Map<string, number>();
  return {
    days,
    prepare(sql: string) {
      return {
        bind: (...a: unknown[]) => ({
          first: async () => {
            const day = a[0] as string;
            if (sql.startsWith("INSERT")) { days.set(day, (days.get(day) ?? 0) + (a[1] as number)); return { calls: days.get(day) }; }
            return days.has(day) ? { calls: days.get(day) } : null;
          },
          run: async () => { days.set(a[0] as string, (days.get(a[0] as string) ?? 0) - (a[1] as number)); },
        }),
      };
    },
  };
}

const now = new Date("2026-11-05T14:00:00Z");

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

describe("the daily cap on paid model calls", () => {
  it("lets calls through up to the cap and refuses the one past it without counting it", async () => {
    const DB = fakeDb(), env = { DB, AI_PER_DAY: "10" } as never;
    expect((await spend(env, 7, false, now)).ok).toBe(true);
    const refused = await spend(env, 7, false, now);
    expect(refused).toMatchObject({ ok: false, used: 7, cap: 10, resetsAt: "2026-11-06T00:00:00.000Z" });
    expect(DB.days.get("2026-11-05")).toBe(7);          // the refusal used nothing up
    expect((await spend(env, 3, false, now)).ok).toBe(true);   // a smaller request still fits
  });

  it("never refuses the owner, but counts their calls", async () => {
    const DB = fakeDb(), env = { DB, AI_PER_DAY: "5" } as never;
    expect((await spend(env, 7, true, now)).ok).toBe(true);
    expect((await usage(env, now)).used).toBe(7);
  });

  it("falls back to 300 when the variable is missing or not a number", () => {
    expect(capOf({} as never)).toBe(300);
    expect(capOf({ AI_PER_DAY: "lots" } as never)).toBe(300);
    expect(capOf({ AI_PER_DAY: "2000" } as never)).toBe(2000);
  });

  it("says it is a limit, not a fault, and when it opens again", () => {
    const b = { used: 300, cap: 300, resetsAt: nextReset(now).toISOString() };
    expect(limitMessage(b, "en", now)).toMatch(/cost limit, not a fault.*00:00 UTC \(in 10 h 0 min\)/);
    expect(limitMessage(b, "de", now)).toMatch(/Kostenbremse, kein Fehler/);
  });
});
