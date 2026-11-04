import { describe, expect, it } from "vitest";
import { share, spread } from "../eval/pick";

describe("picking passages for test questions", () => {
  it("spreads over the source and skips the intro and the credits", () => {
    expect(spread(100, 5)).toEqual([1, 25, 50, 74, 98]);
    expect(spread(3, 3)).toEqual([0, 1, 2]);
    expect(spread(0, 3)).toEqual([]);
  });
  it("takes more from bigger sources, at least two each", () => {
    expect(share([100, 10, 1], 20)).toEqual([18, 2, 1]);
  });
});
