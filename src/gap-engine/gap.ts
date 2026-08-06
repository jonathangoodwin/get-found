import type { GapReport, GscQueryRow, KeywordMetrics, Opportunity, SiteCrawlResult } from "../types.js";
import { canonicalizeTopic, extractPageTopics } from "./topics.js";

export interface StrikingDistanceOptions {
  minPosition?: number;
  maxPosition?: number;
  minImpressions?: number;
}

const STRIKING_DISTANCE_DEFAULTS: Required<StrikingDistanceOptions> = {
  minPosition: 11,
  maxPosition: 30,
  minImpressions: 10,
};

/**
 * Topics covered by at least one competitor's headings but absent from the
 * own site's headings entirely. Score = number of competitors covering the
 * topic — more independently-covering competitors is a stronger signal of
 * validated demand than any single competitor's choice.
 *
 * Matching happens on canonicalizeTopic's bag-of-words key, not the raw
 * heading string, so "Memory Care Pricing" and "Pricing for Memory Care"
 * are the same opportunity rather than two. The displayed `topic` stays the
 * first-seen human-readable phrasing.
 */
export function computeContentGap(
  ownSite: SiteCrawlResult,
  competitorSites: SiteCrawlResult[]
): Opportunity[] {
  const ownTopicKeys = new Set<string>();
  for (const page of ownSite.pages) {
    for (const topic of extractPageTopics(page)) ownTopicKeys.add(canonicalizeTopic(topic));
  }

  const keyToCompetitors = new Map<string, Set<string>>();
  const keyToDisplayTopic = new Map<string, string>();
  for (const site of competitorSites) {
    for (const page of site.pages) {
      for (const topic of extractPageTopics(page)) {
        const key = canonicalizeTopic(topic);
        if (!key || ownTopicKeys.has(key)) continue;
        if (!keyToCompetitors.has(key)) {
          keyToCompetitors.set(key, new Set());
          keyToDisplayTopic.set(key, topic);
        }
        keyToCompetitors.get(key)!.add(site.domain);
      }
    }
  }

  const opportunities: Opportunity[] = [];
  for (const [key, competitors] of keyToCompetitors) {
    opportunities.push({
      kind: "content-gap",
      topic: keyToDisplayTopic.get(key)!,
      competitorsCovering: Array.from(competitors),
      ownUrl: null,
      currentPosition: null,
      impressions: null,
      opportunityScore: competitors.size,
    });
  }
  return opportunities;
}

/**
 * Own-site queries ranking on page 2 (positions 11-30 by default) — the
 * classic "striking distance" quick-win list: existing content that needs
 * improvement, not new content from scratch.
 */
export function computeStrikingDistance(
  rows: GscQueryRow[],
  opts: StrikingDistanceOptions = {}
): Opportunity[] {
  const { minPosition, maxPosition, minImpressions } = { ...STRIKING_DISTANCE_DEFAULTS, ...opts };

  return rows
    .filter(
      (row) =>
        row.position >= minPosition &&
        row.position <= maxPosition &&
        row.impressions >= minImpressions
    )
    .map((row) => ({
      kind: "striking-distance" as const,
      topic: row.query,
      competitorsCovering: [],
      ownUrl: row.page,
      currentPosition: row.position,
      impressions: row.impressions,
      // Closer to page 1 (position 11) and higher impressions = higher score.
      opportunityScore: row.impressions * (maxPosition + 1 - row.position),
    }));
}

/**
 * Rescales content-gap scores from "number of competitors covering this
 * topic" to real monthly search volume when it's available — a stronger
 * demand signal than coverage count alone. Striking-distance opportunities
 * already carry real GSC impressions, so they're left untouched. Pure:
 * takes pre-fetched metrics rather than calling any keyword-data provider
 * itself (that I/O lives in collectors/dataforseo.ts).
 */
export function applyKeywordVolume(
  opportunities: Opportunity[],
  metricsByKeyword: Map<string, KeywordMetrics>
): Opportunity[] {
  return opportunities.map((opportunity) => {
    if (opportunity.kind !== "content-gap") return opportunity;
    const metrics = metricsByKeyword.get(opportunity.topic.toLowerCase());
    if (!metrics || metrics.searchVolume == null) return opportunity;
    return {
      ...opportunity,
      impressions: metrics.searchVolume,
      opportunityScore: opportunity.competitorsCovering.length * metrics.searchVolume,
    };
  });
}

export function buildGapReport(
  ownDomain: string,
  competitorDomains: string[],
  opportunities: Opportunity[]
): GapReport {
  return {
    generatedAt: new Date().toISOString(),
    ownDomain,
    competitorDomains,
    opportunities: [...opportunities].sort((a, b) => b.opportunityScore - a.opportunityScore),
  };
}
