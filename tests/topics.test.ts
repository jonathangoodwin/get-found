import { describe, expect, it } from "vitest";
import { canonicalizeTopic, normalizeTopic } from "../src/gap-engine/topics.js";

describe("normalizeTopic", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeTopic("  Memory   Care   Pricing  ")).toBe("memory care pricing");
  });

  it("strips trailing separator punctuation", () => {
    expect(normalizeTopic("Memory Care Pricing -")).toBe("memory care pricing");
  });
});

describe("canonicalizeTopic", () => {
  it("collapses topics that differ only in word order", () => {
    expect(canonicalizeTopic("Memory Care Pricing")).toBe(canonicalizeTopic("Pricing for Memory Care"));
  });

  it("collapses simple plural/singular differences", () => {
    expect(canonicalizeTopic("Memory Care Costs")).toBe(canonicalizeTopic("Memory Care Cost"));
  });

  it("ignores stopwords entirely", () => {
    expect(canonicalizeTopic("What is Memory Care")).toBe(canonicalizeTopic("Memory Care"));
  });

  it("keeps genuinely different topics distinct", () => {
    expect(canonicalizeTopic("Memory Care Pricing")).not.toBe(canonicalizeTopic("Assisted Living Pricing"));
  });

  it("returns an empty string for a heading made entirely of stopwords", () => {
    expect(canonicalizeTopic("How is it")).toBe("");
  });
});
