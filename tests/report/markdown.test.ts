import { describe, expect, it } from "vitest";
import { renderMarkdownReport } from "../../src/report/markdown.js";
import type { SnapshotDiff } from "../../src/history/diff.js";
import type { GapReport, Opportunity } from "../../src/types.js";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    kind: "content-gap",
    topic: "memory care pricing",
    competitorsCovering: ["comp.com"],
    ownUrl: null,
    currentPosition: null,
    impressions: null,
    opportunityScore: 1,
    ...overrides,
  };
}

function report(opportunities: Opportunity[] = []): GapReport {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    ownDomain: "ours.com",
    competitorDomains: ["comp.com"],
    opportunities,
  };
}

describe("renderMarkdownReport", () => {
  it("omits the changes section entirely when no diff is passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("Changes since last run");
  });

  it("reports 'no change' when the diff is empty", () => {
    const diff: SnapshotDiff = { newOpportunities: [], resolvedOpportunities: [], changedOpportunities: [] };
    const markdown = renderMarkdownReport(report(), undefined, diff);
    expect(markdown).toContain("## Changes since last run");
    expect(markdown).toContain("No change since the last run.");
  });

  it("lists new, resolved, and changed opportunities", () => {
    const diff: SnapshotDiff = {
      newOpportunities: [opportunity({ topic: "va aid and attendance" })],
      resolvedOpportunities: [opportunity({ topic: "assisted living cost" })],
      changedOpportunities: [
        {
          kind: "striking-distance",
          topic: "memory care near me",
          previousScore: 100,
          currentScore: 200,
          previousPosition: 14,
          currentPosition: 9,
        },
      ],
    };

    const markdown = renderMarkdownReport(report(), undefined, diff);

    expect(markdown).toContain("**New (1):**");
    expect(markdown).toContain("- va aid and attendance");
    expect(markdown).toContain("**Resolved (1):**");
    expect(markdown).toContain("- assisted living cost");
    expect(markdown).toContain("**Changed (1):**");
    expect(markdown).toContain("memory care near me: score 100 → 200 — position 14 → 9");
  });
});
