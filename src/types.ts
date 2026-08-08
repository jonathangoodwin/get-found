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
  isNoindex: boolean;
  fetchedAt: string; // ISO timestamp
}

export interface SiteCrawlResult {
  domain: string;
  pages: PageRecord[];
  /** URLs found in the sitemap that failed to fetch or parse — broken links. */
  failedUrls: string[];
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

export type OpportunityKind = "content-gap" | "striking-distance" | "ranking-watch" | "link-gap";

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

export type HealthFindingType =
  | "broken-link"
  | "missing-title"
  | "duplicate-title"
  | "missing-meta-description"
  | "duplicate-meta-description"
  | "missing-h1"
  | "multiple-h1"
  | "thin-content"
  | "missing-schema"
  | "noindex";

export interface HealthFinding {
  type: HealthFindingType;
  url: string;
  detail: string;
}

/** One sitemap's status from the Search Console Sitemaps API. */
export interface SitemapStatus {
  path: string;
  lastDownloaded: string | null;
  isPending: boolean;
  warnings: number;
  errors: number;
  contents: Array<{ type: string; submitted: number; indexed: number }>;
}

/** Real-user Core Web Vitals (75th percentile) for one URL, from the Chrome UX Report. */
export interface CoreWebVitals {
  url: string;
  lcpMs: number | null;
  inpMs: number | null;
  cls: number | null;
}

/** A domain that links to at least one competitor but not to the own site — a link-gap candidate. */
export interface BacklinkDomain {
  domain: string;
  /** DataForSEO's domain authority estimate (0-1000 scale). */
  rank: number;
  competitorsLinking: string[];
}

/**
 * Publicly published contact info discovered on a target's own site — never
 * guessed or invented. `email`/`contactPageUrl`/`socialLinks` are only ever
 * populated from links the site itself chose to publish.
 */
export interface ContactChannel {
  url: string;
  email: string | null;
  contactPageUrl: string | null;
  socialLinks: string[];
}

/**
 * A drafted outreach message for a human to review and send themselves —
 * this tool never sends outreach on its own. `source` is labeled the same
 * way as ContentBrief for the same reason: AI output needs a human in the loop.
 */
export interface OutreachDraft {
  targetDomain: string;
  subject: string;
  message: string;
  source: "rule-based" | "ai-drafted";
}
