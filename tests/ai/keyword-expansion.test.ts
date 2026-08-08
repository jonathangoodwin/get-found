import { describe, expect, it } from "vitest";
import { RuleBasedKeywordExpander } from "../../src/ai/keyword-expansion.js";

describe("RuleBasedKeywordExpander", () => {
  it("expands each theme with a fixed set of modifiers, including the bare theme", async () => {
    const expander = new RuleBasedKeywordExpander();
    const result = await expander.expandKeywords(["memory care"], {});
    expect(result).toContain("memory care");
    expect(result).toContain("memory care pricing");
    expect(result).toContain("memory care cost");
    expect(result).toContain("memory care near me");
  });

  it("dedupes across themes and modifiers", async () => {
    const expander = new RuleBasedKeywordExpander();
    const result = await expander.expandKeywords(["memory care", "memory care"], {});
    expect(result.filter((k) => k === "memory care")).toHaveLength(1);
  });

  it("caps the total number of keywords returned", async () => {
    const expander = new RuleBasedKeywordExpander(5);
    const result = await expander.expandKeywords(["a", "b", "c"], {});
    expect(result.length).toBeLessThanOrEqual(5);
  });

  it("returns an empty list for no themes", async () => {
    const expander = new RuleBasedKeywordExpander();
    expect(await expander.expandKeywords([], {})).toEqual([]);
  });
});
