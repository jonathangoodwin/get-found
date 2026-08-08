import { crawlSite } from "./collectors/crawl.js";
import { fetchCoreWebVitalsForUrls, loadCruxCredentialsFromEnv } from "./collectors/crux.js";
import { DataForSeoProvider, loadDataForSeoCredentialsFromEnv } from "./collectors/dataforseo.js";
import { fetchSearchAnalytics, fetchSitemapStatus, loadGscCredentialsFromEnv } from "./collectors/gsc.js";
import {
  applyKeywordVolume,
  buildGapReport,
  computeContentGap,
  computeRankingWatch,
  computeStrikingDistance,
} from "./gap-engine/gap.js";
import { runHealthChecks } from "./health/checks.js";
import { diffReports, type SnapshotDiff } from "./history/diff.js";
import { DEFAULT_HISTORY_DIR, FileHistoryStore } from "./history/store.js";
import { ClaudeBriefDrafter, RuleBasedBriefDrafter, type BriefDrafter } from "./ai/brief.js";
import type {
  ContentBrief,
  CoreWebVitals,
  GapReport,
  HealthFinding,
  Opportunity,
  SitemapStatus,
} from "./types.js";

export interface RunOptions {
  site: string;
  competitors?: string[];
  gscSiteUrl?: string;
  maxPages?: number;
  thinContentWordCount?: number;
  cwvPages?: number;
  historyDir?: string;
  saveHistory?: boolean;
  briefsLimit?: number;
  useAi?: boolean;
  businessContext?: string;
  /** Called with human-readable progress lines as the run proceeds. */
  onProgress?: (message: string) => void;
}

export interface RunResult {
  report: GapReport;
  diff: SnapshotDiff | null;
  healthFindings: HealthFinding[];
  sitemapStatuses: SitemapStatus[];
  coreWebVitals: CoreWebVitals[];
  briefs: Map<string, ContentBrief>;
}

/**
 * The full standard-crawl pipeline, shared by the CLI and the Slack
 * integration so there's exactly one place that decides what "run an
 * analysis" means. Callers render the result however fits their surface
 * (markdown for the CLI, Block Kit for Slack).
 */
export async function runAnalysis(opts: RunOptions): Promise<RunResult> {
  const log = opts.onProgress ?? (() => {});
  const maxPages = opts.maxPages ?? 200;
  const competitors = opts.competitors ?? [];

  const historyStore = new FileHistoryStore(opts.historyDir ?? DEFAULT_HISTORY_DIR);
  const previousReport = await historyStore.loadLatest(opts.site);

  log(`Crawling ${opts.site}...`);
  const ownSite = await crawlSite(opts.site, { maxPages });

  const competitorSites = [];
  for (const domain of competitors) {
    log(`Crawling ${domain}...`);
    competitorSites.push(await crawlSite(domain, { maxPages }));
  }

  const healthFindings: HealthFinding[] = runHealthChecks(ownSite, {
    thinContentWordCount: opts.thinContentWordCount ?? 300,
  });

  let strikingDistance: Opportunity[] = [];
  let rankingWatch: Opportunity[] = [];
  let sitemapStatuses: SitemapStatus[] = [];
  if (opts.gscSiteUrl) {
    const credentials = loadGscCredentialsFromEnv();
    if (!credentials) {
      log(
        "Warning: a Search Console site URL was given but GSC_CLIENT_ID/GSC_CLIENT_SECRET/GSC_REFRESH_TOKEN are not set. Skipping Search Console analysis."
      );
    } else {
      log(`Fetching Search Console data for ${opts.gscSiteUrl}...`);
      const rows = await fetchSearchAnalytics(opts.gscSiteUrl, credentials, {
        startDate: defaultStartDate(),
        endDate: defaultEndDate(),
      });
      strikingDistance = computeStrikingDistance(rows);
      rankingWatch = computeRankingWatch(rows);
      sitemapStatuses = await fetchSitemapStatus(opts.gscSiteUrl, credentials);
    }
  }

  let coreWebVitals: CoreWebVitals[] = [];
  const cruxCredentials = loadCruxCredentialsFromEnv();
  if (cruxCredentials) {
    const cwvPages = ownSite.pages.slice(0, opts.cwvPages ?? 5).map((p) => p.url);
    if (cwvPages.length > 0) {
      log(`Fetching Core Web Vitals for ${cwvPages.length} page(s)...`);
      coreWebVitals = await fetchCoreWebVitalsForUrls(cwvPages, cruxCredentials);
    }
  }

  let contentGap = computeContentGap(ownSite, competitorSites);

  const dataForSeoCredentials = loadDataForSeoCredentialsFromEnv();
  if (dataForSeoCredentials && contentGap.length > 0) {
    log(`Fetching keyword volume for ${contentGap.length} topics from DataForSEO...`);
    const provider = new DataForSeoProvider(dataForSeoCredentials);
    const metrics = await provider.getSearchVolume(contentGap.map((o) => o.topic));
    const metricsByKeyword = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
    contentGap = applyKeywordVolume(contentGap, metricsByKeyword);
  }

  const report = buildGapReport(opts.site, competitors, [...contentGap, ...strikingDistance, ...rankingWatch]);

  const diff: SnapshotDiff | null = previousReport ? diffReports(previousReport, report) : null;
  if (opts.saveHistory !== false) {
    await historyStore.save(report);
  }

  const briefLimit = opts.briefsLimit ?? 10;
  // ranking-watch entries are visibility, not something to draft a content brief for.
  const briefableOpportunities = report.opportunities.filter((o) => o.kind !== "ranking-watch");
  const briefs = await draftBriefs(briefableOpportunities.slice(0, briefLimit), {
    useAi: opts.useAi ?? true,
    businessContext: opts.businessContext,
    log,
  });

  return { report, diff, healthFindings, sitemapStatuses, coreWebVitals, briefs };
}

async function draftBriefs(
  opportunities: Opportunity[],
  opts: { useAi: boolean; businessContext?: string; log: (message: string) => void }
): Promise<Map<string, ContentBrief>> {
  const ruleBased = new RuleBasedBriefDrafter();
  const canUseAi = opts.useAi && Boolean(process.env.ANTHROPIC_API_KEY);
  const primary: BriefDrafter = canUseAi
    ? new ClaudeBriefDrafter({ businessContext: opts.businessContext })
    : ruleBased;

  if (opportunities.length > 0) {
    opts.log(
      `Drafting ${opportunities.length} content brief(s)${canUseAi ? " with Claude" : " (rule-based — no ANTHROPIC_API_KEY set)"}...`
    );
  }

  const briefs = new Map<string, ContentBrief>();
  for (const opportunity of opportunities) {
    try {
      briefs.set(opportunity.topic, await primary.draftBrief(opportunity));
    } catch (err) {
      if (canUseAi) {
        opts.log(`Claude brief drafting failed for "${opportunity.topic}", falling back to rule-based: ${(err as Error).message}`);
        briefs.set(opportunity.topic, await ruleBased.draftBrief(opportunity));
      } else {
        throw err;
      }
    }
  }
  return briefs;
}

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3);
  return d.toISOString().slice(0, 10);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3 - 90);
  return d.toISOString().slice(0, 10);
}
