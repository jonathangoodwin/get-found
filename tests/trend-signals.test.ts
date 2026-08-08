import { describe, expect, it } from "vitest";
import { matchTrendSignals } from "../src/gap-engine/trends.js";
import type { TrendingSearch } from "../src/types.js";

function search(overrides: Partial<TrendingSearch> = {}): TrendingSearch {
  return {
    query: "memory care pricing",
    approxTraffic: "1000+",
    newsItems: [],
    ...overrides,
  };
}

describe("matchTrendSignals", () => {
  it("matches a trending search to a tracked topic using fuzzy topic comparison", () => {
    const signals = matchTrendSignals([search({ query: "Pricing for Memory Care" })], ["memory care pricing"]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({
      topic: "memory care pricing",
      matchedQuery: "Pricing for Memory Care",
      approxTraffic: "1000+",
    });
  });

  it("ignores trending searches that don't match any tracked topic", () => {
    expect(matchTrendSignals([search({ query: "unrelated celebrity news" })], ["memory care pricing"])).toEqual([]);
  });

  it("ignores tracked topics that aren't currently trending", () => {
    expect(matchTrendSignals([], ["memory care pricing", "assisted living cost"])).toEqual([]);
  });

  it("carries through news items as evidence", () => {
    const news = [{ title: "Story", url: "https://example.com/a", source: "Example" }];
    const signals = matchTrendSignals([search({ newsItems: news })], ["memory care pricing"]);
    expect(signals[0].newsItems).toEqual(news);
  });

  it("sorts matches by approximate traffic, highest first", () => {
    const signals = matchTrendSignals(
      [
        search({ query: "memory care pricing", approxTraffic: "500+" }),
        search({ query: "assisted living cost", approxTraffic: "5000+" }),
      ],
      ["memory care pricing", "assisted living cost"]
    );
    expect(signals.map((s) => s.topic)).toEqual(["assisted living cost", "memory care pricing"]);
  });

  it("treats a null approxTraffic as lowest priority without crashing", () => {
    const signals = matchTrendSignals(
      [
        search({ query: "memory care pricing", approxTraffic: null }),
        search({ query: "assisted living cost", approxTraffic: "10+" }),
      ],
      ["memory care pricing", "assisted living cost"]
    );
    expect(signals.map((s) => s.topic)).toEqual(["assisted living cost", "memory care pricing"]);
  });
});
