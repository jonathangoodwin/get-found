import { describe, expect, it } from "vitest";
import { diffReports } from "../../src/history/diff.js";
import type { GapReport, Opportunity } from "../../src/types.js";

function opportunity(overrides: Partial<Opportunity>): Opportunity {
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

function report(opportunities: Opportunity[]): GapReport {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    ownDomain: "ours.com",
    competitorDomains: ["comp.com"],
    opportunities,
  };
}

describe("diffReports", () => {
  it("flags an opportunity present now but absent before as new", () => {
    const previous = report([]);
    const current = report([opportunity({ topic: "va aid and attendance" })]);

    const diff = diffReports(previous, current);

    expect(diff.newOpportunities).toHaveLength(1);
    expect(diff.newOpportunities[0].topic).toBe("va aid and attendance");
    expect(diff.resolvedOpportunities).toHaveLength(0);
    expect(diff.changedOpportunities).toHaveLength(0);
  });

  it("flags an opportunity present before but absent now as resolved", () => {
    const previous = report([opportunity({ topic: "memory care pricing" })]);
    const current = report([]);

    const diff = diffReports(previous, current);

    expect(diff.resolvedOpportunities).toHaveLength(1);
    expect(diff.resolvedOpportunities[0].topic).toBe("memory care pricing");
    expect(diff.newOpportunities).toHaveLength(0);
  });

  it("flags a score change on an opportunity present in both runs", () => {
    const previous = report([opportunity({ topic: "memory care pricing", opportunityScore: 2 })]);
    const current = report([opportunity({ topic: "memory care pricing", opportunityScore: 5 })]);

    const diff = diffReports(previous, current);

    expect(diff.newOpportunities).toHaveLength(0);
    expect(diff.resolvedOpportunities).toHaveLength(0);
    expect(diff.changedOpportunities).toEqual([
      {
        kind: "content-gap",
        topic: "memory care pricing",
        previousScore: 2,
        currentScore: 5,
        previousPosition: null,
        currentPosition: null,
      },
    ]);
  });

  it("flags a striking-distance position move even when the score is identical", () => {
    const previous = report([
      opportunity({ kind: "striking-distance", topic: "assisted living cost", currentPosition: 14, opportunityScore: 100 }),
    ]);
    const current = report([
      opportunity({ kind: "striking-distance", topic: "assisted living cost", currentPosition: 9, opportunityScore: 100 }),
    ]);

    const diff = diffReports(previous, current);

    expect(diff.changedOpportunities).toHaveLength(1);
    expect(diff.changedOpportunities[0].previousPosition).toBe(14);
    expect(diff.changedOpportunities[0].currentPosition).toBe(9);
  });

  it("ignores score deltas at or below the threshold", () => {
    const previous = report([opportunity({ topic: "memory care pricing", opportunityScore: 100 })]);
    const current = report([opportunity({ topic: "memory care pricing", opportunityScore: 105 })]);

    expect(diffReports(previous, current, { scoreChangeThreshold: 10 }).changedOpportunities).toHaveLength(0);
    expect(diffReports(previous, current, { scoreChangeThreshold: 4 }).changedOpportunities).toHaveLength(1);
  });

  it("treats identical opportunities across runs as no change", () => {
    const previous = report([opportunity({ topic: "memory care pricing" })]);
    const current = report([opportunity({ topic: "memory care pricing" })]);

    const diff = diffReports(previous, current);
    expect(diff).toEqual({ newOpportunities: [], resolvedOpportunities: [], changedOpportunities: [] });
  });

  it("matches opportunities by kind and topic, not array order", () => {
    const previous = report([
      opportunity({ topic: "a", opportunityScore: 1 }),
      opportunity({ topic: "b", opportunityScore: 1 }),
    ]);
    const current = report([
      opportunity({ topic: "b", opportunityScore: 1 }),
      opportunity({ topic: "a", opportunityScore: 1 }),
    ]);

    const diff = diffReports(previous, current);
    expect(diff.newOpportunities).toHaveLength(0);
    expect(diff.resolvedOpportunities).toHaveLength(0);
    expect(diff.changedOpportunities).toHaveLength(0);
  });
});
