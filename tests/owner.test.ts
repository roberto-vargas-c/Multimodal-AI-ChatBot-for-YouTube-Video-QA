import { describe, expect, it } from "vitest";
import { isOwner } from "../src/index";
import type { Env } from "../src/types";

const env = { OWNER_TOKEN: "owner-secret-0123456789", INGEST_TOKEN: "ingest-secret-0123456789" } as Env;
const req = (auth?: string) => new Request("https://x/api/ask", { headers: auth ? { authorization: auth } : {} });

describe("who searches the private books", () => {
  it("the owner token or the ingest token, nobody else", () => {
    expect(isOwner(req("Bearer owner-secret-0123456789"), env)).toBe(true);
    expect(isOwner(req("Bearer ingest-secret-0123456789"), env)).toBe(true);
    expect(isOwner(req(), env)).toBe(false);
    expect(isOwner(req("Bearer wrong"), env)).toBe(false);
    expect(isOwner(req("Bearer "), { } as Env)).toBe(false);
    expect(isOwner(req("Bearer short"), { OWNER_TOKEN: "short" } as Env)).toBe(false);
  });
});
