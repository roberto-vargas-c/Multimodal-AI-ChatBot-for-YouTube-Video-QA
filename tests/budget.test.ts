import { describe, expect, it } from "vitest";
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
