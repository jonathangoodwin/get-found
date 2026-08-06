/**
 * Core domain model. Pure data — no framework, no network, no AI dependency.
 * Every downstream layer (gap-engine, report, ai) reads/writes these shapes.
 */

export interface PageRecord {
  url: string;
  domain: string;
  title: string | null;
  metaDescription: string | null;
  h1: string[];
  h2: string[];
  h3: string[];
  wordCount: number;
  canonicalUrl: string | null;
  hasSchema: boolean;
  fetchedAt: string; // ISO timestamp
}

export interface SiteCrawlResult {
  domain: string;
  pages: PageRecord[];
  crawledAt: string;
}

/** One row from the Search Console Search Analytics API. */
export interface GscQueryRow {
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export type OpportunityKind = "content-gap" | "striking-distance";

export interface Opportunity {
  kind: OpportunityKind;
  topic: string;
  /** Competitor domains that cover this topic (content-gap only). */
  competitorsCovering: string[];
  /** Existing own-site URL this opportunity attaches to, if any. */
  ownUrl: string | null;
  /** Current average position, for striking-distance opportunities. */
  currentPosition: number | null;
  /** Monthly impressions from GSC, when available — used for scoring. */
  impressions: number | null;
  opportunityScore: number;
}

export interface GapReport {
  generatedAt: string;
  ownDomain: string;
  competitorDomains: string[];
  opportunities: Opportunity[];
}

/** Real keyword volume/competition data, e.g. from a paid SERP/keyword provider. */
export interface KeywordMetrics {
  keyword: string;
  searchVolume: number | null;
  competitionIndex: number | null;
  cpc: number | null;
}

export interface ContentBrief {
  topic: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  searchIntent: "informational" | "commercial" | "transactional" | "navigational" | "unknown";
  suggestedHeadings: string[];
  questionsToAnswer: string[];
  notes: string;
  source: "rule-based" | "ai-drafted";
}
