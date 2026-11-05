import { describe, expect, it } from "vitest";
import { toHit } from "../src/store";

describe("search hits", () => {
  it("take their text from pageContent, where LangChain's Vectorize store puts it", () => {
    // what CloudflareVectorizeStore returns: `text` taken out of the metadata and given as pageContent
    const h = toHit({ pageContent: "Life between buildings needs soft edges.", metadata: { sourceId: "gehl-places", index: 4, kind: "book", author: "Jan Gehl", title: "Places for People", page: 34 } }, 0.8);
    expect(h.chunkId).toBe("gehl-places:4");
    expect(h.text).toBe("Life between buildings needs soft edges.");
    expect(h.quote).toBe("Life between buildings needs soft edges.");
    expect(h.where).toBe("p. 34");
  });
});
