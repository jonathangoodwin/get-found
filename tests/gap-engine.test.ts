import { describe, expect, it } from "vitest";
import {
  applyKeywordVolume,
  buildGapReport,
  computeContentGap,
  computeLinkGap,
  computeRankingWatch,
  computeStrikingDistance,
} from "../src/gap-engine/gap.js";
import type { BacklinkDomain, GscQueryRow, KeywordMetrics, Opportunity, PageRecord, SiteCrawlResult } from "../src/types.js";

function page(overrides: Partial<PageRecord>): PageRecord {
  return {
    url: "https://example.com/page",
    domain: "example.com",
    title: null,
    metaDescription: null,
    h1: [],
    h2: [],
    h3: [],
    wordCount: 500,
    canonicalUrl: null,
    hasSchema: false,
    isNoindex: false,
    internalLinks: [],
    fetchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function site(domain: string, pages: PageRecord[]): SiteCrawlResult {
  return { domain, pages, failedUrls: [], crawledAt: "2026-08-01T00:00:00.000Z" };
}

describe("computeContentGap", () => {
  it("flags topics competitors cover that the own site never mentions", () => {
    const own = site("ours.com", [page({ domain: "ours.com", h2: ["Memory care pricing"] })]);
    const competitorA = site("compa.com", [
      page({ domain: "compa.com", h2: ["Memory care pricing", "VA Aid and Attendance benefit"] }),
    ]);
    const competitorB = site("compb.com", [
      page({ domain: "compb.com", h2: ["VA Aid and Attendance benefit"] }),
    ]);

    const opportunities = computeContentGap(own, [competitorA, competitorB]);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].topic).toBe("va aid and attendance benefit");
    expect(opportunities[0].competitorsCovering.sort()).toEqual(["compa.com", "compb.com"]);
    expect(opportunities[0].opportunityScore).toBe(2);
  });

  it("returns nothing when the own site already covers every competitor topic", () => {
    const own = site("ours.com", [page({ domain: "ours.com", h2: ["Assisted living cost"] })]);
    const competitor = site("comp.com", [page({ domain: "comp.com", h2: ["Assisted Living Cost"] })]);

    expect(computeContentGap(own, [competitor])).toHaveLength(0);
  });

  it("falls back to title when a page has no headings", () => {
    const own = site("ours.com", []);
    const competitor = site("comp.com", [
      page({ domain: "comp.com", title: "How Medicaid Spend-Down Works", h2: [], h3: [], h1: [] }),
    ]);

    const opportunities = computeContentGap(own, [competitor]);
    expect(opportunities[0].topic).toBe("how medicaid spend-down works");
  });

  it("merges competitor headings that are the same topic reworded, into one opportunity", () => {
    const own = site("ours.com", []);
    const competitorA = site("compa.com", [page({ domain: "compa.com", h2: ["Memory Care Pricing"] })]);
    const competitorB = site("compb.com", [page({ domain: "compb.com", h2: ["Pricing for Memory Care"] })]);

    const opportunities = computeContentGap(own, [competitorA, competitorB]);

    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].competitorsCovering.sort()).toEqual(["compa.com", "compb.com"]);
    expect(opportunities[0].opportunityScore).toBe(2);
  });

  it("does not flag a gap when the own site already covers the topic under different wording", () => {
    const own = site("ours.com", [page({ domain: "ours.com", h2: ["Cost of Memory Care"] })]);
    const competitor = site("comp.com", [page({ domain: "comp.com", h2: ["Memory Care Costs"] })]);

    expect(computeContentGap(own, [competitor])).toHaveLength(0);
  });
});

describe("computeLinkGap", () => {
  function backlinkDomain(overrides: Partial<BacklinkDomain> = {}): BacklinkDomain {
    return { domain: "senior-resources.org", rank: 250, competitorsLinking: ["compa.com"], ...overrides };
  }

  it("maps a BacklinkDomain into a link-gap Opportunity", () => {
    const [opportunity] = computeLinkGap([backlinkDomain()]);
    expect(opportunity.kind).toBe("link-gap");
    expect(opportunity.topic).toBe("senior-resources.org");
    expect(opportunity.competitorsCovering).toEqual(["compa.com"]);
  });

  it("scores by competitor count times domain rank", () => {
    const [opportunity] = computeLinkGap([backlinkDomain({ rank: 100, competitorsLinking: ["a.com", "b.com"] })]);
    expect(opportunity.opportunityScore).toBe(200);
  });

  it("floors the rank at 1 so a zero-rank domain doesn't zero out the score", () => {
    const [opportunity] = computeLinkGap([backlinkDomain({ rank: 0, competitorsLinking: ["a.com", "b.com"] })]);
    expect(opportunity.opportunityScore).toBe(2);
  });

  it("returns an empty list for no domains", () => {
    expect(computeLinkGap([])).toEqual([]);
  });
});

describe("computeStrikingDistance", () => {
  const rows: GscQueryRow[] = [
    { query: "assisted living cost calculator", page: "/tools/calculator", clicks: 12, impressions: 800, ctr: 0.015, position: 14 },
    { query: "va aid and attendance eligibility", page: "/va-benefits", clicks: 3, impressions: 200, ctr: 0.015, position: 22 },
    { query: "memory care near me", page: "/memory-care", clicks: 40, impressions: 5000, ctr: 0.008, position: 3 }, // already page 1, excluded
    { query: "long term care insurance payout", page: "/ltc", clicks: 0, impressions: 5, ctr: 0, position: 18 }, // below min impressions
  ];

  it("keeps only page-2 (11-30) queries above the impression floor", () => {
    const opportunities = computeStrikingDistance(rows);
    const topics = opportunities.map((o) => o.topic);
    expect(topics).toContain("assisted living cost calculator");
    expect(topics).toContain("va aid and attendance eligibility");
    expect(topics).not.toContain("memory care near me");
    expect(topics).not.toContain("long term care insurance payout");
  });

  it("scores higher impressions and closer-to-page-1 position more highly", () => {
    const opportunities = computeStrikingDistance(rows);
    const calculator = opportunities.find((o) => o.topic === "assisted living cost calculator")!;
    const vaEligibility = opportunities.find((o) => o.topic === "va aid and attendance eligibility")!;
    expect(calculator.opportunityScore).toBeGreaterThan(vaEligibility.opportunityScore);
  });

  it("respects custom thresholds", () => {
    const opportunities = computeStrikingDistance(rows, { minImpressions: 1000 });
    expect(opportunities).toHaveLength(0);
  });
});

describe("computeRankingWatch", () => {
  const rows: GscQueryRow[] = [
    { query: "memory care near me", page: "/memory-care", clicks: 40, impressions: 5000, ctr: 0.008, position: 3 },
    { query: "assisted living cost calculator", page: "/tools/calculator", clicks: 12, impressions: 800, ctr: 0.015, position: 14 },
    { query: "long term care insurance payout", page: "/ltc", clicks: 0, impressions: 5, ctr: 0, position: 18 },
  ];

  it("includes page-1 queries, unlike striking distance", () => {
    const opportunities = computeRankingWatch(rows);
    expect(opportunities.map((o) => o.topic)).toContain("memory care near me");
  });

  it("sorts by impressions descending", () => {
    const opportunities = computeRankingWatch(rows);
    expect(opportunities.map((o) => o.topic)).toEqual([
      "memory care near me",
      "assisted living cost calculator",
      "long term care insurance payout",
    ]);
  });

  it("tags every entry with kind ranking-watch and score = impressions", () => {
    const opportunities = computeRankingWatch(rows);
    expect(opportunities.every((o) => o.kind === "ranking-watch")).toBe(true);
    expect(opportunities[0].opportunityScore).toBe(5000);
  });

  it("respects a custom limit", () => {
    expect(computeRankingWatch(rows, { limit: 1 })).toHaveLength(1);
  });
});

describe("applyKeywordVolume", () => {
  const gapOpportunity: Opportunity = {
    kind: "content-gap",
    topic: "va aid and attendance benefit",
    competitorsCovering: ["compa.com", "compb.com"],
    ownUrl: null,
    currentPosition: null,
    impressions: null,
    opportunityScore: 2, // the coverage-count heuristic
  };
  const strikingDistanceOpportunity: Opportunity = {
    kind: "striking-distance",
    topic: "assisted living cost calculator",
    competitorsCovering: [],
    ownUrl: "/tools/calculator",
    currentPosition: 14,
    impressions: 800,
    opportunityScore: 800 * (31 - 14),
  };

  it("rescales content-gap score by real search volume when available", () => {
    const metrics: KeywordMetrics = {
      keyword: "va aid and attendance benefit",
      searchVolume: 1200,
      competitionIndex: 40,
      cpc: 3.2,
    };
    const metricsByKeyword = new Map([["va aid and attendance benefit", metrics]]);

    const [result] = applyKeywordVolume([gapOpportunity], metricsByKeyword);
    expect(result.impressions).toBe(1200);
    expect(result.opportunityScore).toBe(2 * 1200);
  });

  it("leaves the opportunity untouched when no metrics match", () => {
    const [result] = applyKeywordVolume([gapOpportunity], new Map());
    expect(result).toEqual(gapOpportunity);
  });

  it("never rescales striking-distance opportunities (they already carry real GSC impressions)", () => {
    const metrics: KeywordMetrics = {
      keyword: "assisted living cost calculator",
      searchVolume: 99999,
      competitionIndex: null,
      cpc: null,
    };
    const metricsByKeyword = new Map([["assisted living cost calculator", metrics]]);

    const [result] = applyKeywordVolume([strikingDistanceOpportunity], metricsByKeyword);
    expect(result).toEqual(strikingDistanceOpportunity);
  });
});

describe("buildGapReport", () => {
  it("sorts opportunities by score descending and stamps metadata", () => {
    const report = buildGapReport("ours.com", ["comp.com"], [
      { kind: "content-gap", topic: "low", competitorsCovering: ["comp.com"], ownUrl: null, currentPosition: null, impressions: null, opportunityScore: 1 },
      { kind: "content-gap", topic: "high", competitorsCovering: ["comp.com"], ownUrl: null, currentPosition: null, impressions: null, opportunityScore: 9 },
    ]);

    expect(report.ownDomain).toBe("ours.com");
    expect(report.opportunities.map((o) => o.topic)).toEqual(["high", "low"]);
    expect(report.generatedAt).toBeTruthy();
  });
});
