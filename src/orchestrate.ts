import { crawlSite } from "./collectors/crawl.js";
import { fetchCoreWebVitalsForUrls, loadCruxCredentialsFromEnv } from "./collectors/crux.js";
import { DataForSeoProvider, fetchLinkGapDomains, loadDataForSeoCredentialsFromEnv } from "./collectors/dataforseo.js";
import { fetchSearchAnalytics, fetchSitemapStatus, loadGscCredentialsFromEnv } from "./collectors/gsc.js";
import { discoverContactChannel } from "./collectors/outreach-contact.js";
import { fetchTrendingSearches } from "./collectors/trends.js";
import {
  applyKeywordVolume,
  buildGapReport,
  computeContentGap,
  computeLinkGap,
  computeRankingWatch,
  computeStrikingDistance,
} from "./gap-engine/gap.js";
import { matchTrendSignals } from "./gap-engine/trends.js";
import { diagnoseBrokenLinks } from "./health/broken-link-diagnosis.js";
import { runHealthChecks } from "./health/checks.js";
import { diffReports, type SnapshotDiff } from "./history/diff.js";
import { DEFAULT_HISTORY_DIR, FileHistoryStore } from "./history/store.js";
import { ClaudeBriefDrafter, RuleBasedBriefDrafter, type BriefDrafter } from "./ai/brief.js";
import { ClaudeOutreachDrafter, RuleBasedOutreachDrafter, type OutreachDrafter } from "./ai/outreach.js";
import type {
  BrokenLinkDiagnosis,
  ContactChannel,
  ContentBrief,
  CoreWebVitals,
  GapReport,
  HealthFinding,
  Opportunity,
  OutreachDraft,
  SitemapStatus,
  TrendSignal,
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
  /** Opt-in: hits the paid DataForSEO Backlinks API and crawls each target site for a contact channel. Off by default. */
  enableLinkGap?: boolean;
  /** How many top link-gap targets get contact discovery + an outreach draft. */
  outreachDraftLimit?: number;
  /** Opt-in: polls Google's real-time trending-searches feed and matches it against tracked topics. Off by default. */
  enableTrends?: boolean;
  /** Region code for the trending-searches feed, e.g. "US". */
  trendsGeo?: string;
  /** Extra topics to watch for beyond this run's content-gap opportunities. */
  trendsTopics?: string[];
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
  /** Publicly published contact channel per link-gap target domain, keyed by domain. Only populated for the top outreachDraftLimit targets. */
  contacts: Map<string, ContactChannel>;
  /** Draft-only outreach messages, keyed by target domain — never sent automatically. */
  outreachDrafts: Map<string, OutreachDraft>;
  /** Tracked topics currently matching a Google trending search, newest/highest-traffic first. */
  trendSignals: TrendSignal[];
  /** Each broken URL classified by whether a live page actually links to it, plus a suggested replacement. */
  brokenLinkDiagnoses: BrokenLinkDiagnosis[];
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
  const brokenLinkDiagnoses = diagnoseBrokenLinks(ownSite);

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

  let linkGap: Opportunity[] = [];
  const contacts = new Map<string, ContactChannel>();
  const outreachDrafts = new Map<string, OutreachDraft>();
  if (opts.enableLinkGap && dataForSeoCredentials && competitors.length > 0) {
    log(`Fetching backlink gap for ${competitors.length} competitor(s) from DataForSEO...`);
    const gapDomains = await fetchLinkGapDomains(opts.site, competitors, dataForSeoCredentials);
    linkGap = computeLinkGap(gapDomains);

    const outreachLimit = opts.outreachDraftLimit ?? 10;
    const outreachTargets = [...linkGap].sort((a, b) => b.opportunityScore - a.opportunityScore).slice(0, outreachLimit);

    if (outreachTargets.length > 0) {
      const outreachDrafter = buildOutreachDrafter(opts.useAi ?? true);
      for (const target of outreachTargets) {
        log(`Discovering contact info for ${target.topic}...`);
        const contact = await discoverContactChannel(target.topic);
        if (contact) contacts.set(target.topic, contact);

        const draft = await draftOutreach(outreachDrafter, target, contact, {
          ownDomain: opts.site,
          businessContext: opts.businessContext,
        });
        outreachDrafts.set(target.topic, draft);
      }
    }
  }

  const report = buildGapReport(opts.site, competitors, [
    ...contentGap,
    ...strikingDistance,
    ...rankingWatch,
    ...linkGap,
  ]);

  let trendSignals: TrendSignal[] = [];
  if (opts.enableTrends) {
    // link-gap topics are domains, not search topics — everything else (content-gap headings,
    // striking-distance/ranking-watch queries) is fair game to watch for a trending match.
    const watchTopics = dedupeTopics([
      ...report.opportunities.filter((o) => o.kind !== "link-gap").map((o) => o.topic),
      ...(opts.trendsTopics ?? []),
    ]);
    if (watchTopics.length > 0) {
      log(`Checking Google trending searches (${opts.trendsGeo ?? "US"}) against ${watchTopics.length} tracked topic(s)...`);
      const trending = await fetchTrendingSearches(opts.trendsGeo ?? "US");
      trendSignals = matchTrendSignals(trending, watchTopics);
    }
  }

  const diff: SnapshotDiff | null = previousReport ? diffReports(previousReport, report) : null;
  if (opts.saveHistory !== false) {
    await historyStore.save(report);
  }

  const briefLimit = opts.briefsLimit ?? 10;
  // ranking-watch is visibility-only, and link-gap gets an outreach draft instead of a content brief.
  const briefableOpportunities = report.opportunities.filter(
    (o) => o.kind !== "ranking-watch" && o.kind !== "link-gap"
  );
  const briefs = await draftBriefs(briefableOpportunities.slice(0, briefLimit), {
    useAi: opts.useAi ?? true,
    businessContext: opts.businessContext,
    log,
  });

  return { report, diff, healthFindings, sitemapStatuses, coreWebVitals, briefs, contacts, outreachDrafts, trendSignals, brokenLinkDiagnoses };
}

function dedupeTopics(topics: string[]): string[] {
  return Array.from(new Set(topics));
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

interface OutreachDrafterHandle {
  primary: OutreachDrafter;
  ruleBased: RuleBasedOutreachDrafter;
  canUseAi: boolean;
}

function buildOutreachDrafter(useAi: boolean): OutreachDrafterHandle {
  const ruleBased = new RuleBasedOutreachDrafter();
  const canUseAi = useAi && Boolean(process.env.ANTHROPIC_API_KEY);
  const primary: OutreachDrafter = canUseAi ? new ClaudeOutreachDrafter() : ruleBased;
  return { primary, ruleBased, canUseAi };
}

async function draftOutreach(
  drafter: OutreachDrafterHandle,
  opportunity: Opportunity,
  contact: ContactChannel | null,
  context: { ownDomain: string; businessContext?: string }
): Promise<OutreachDraft> {
  try {
    return await drafter.primary.draftOutreach(opportunity, contact, context);
  } catch (err) {
    if (drafter.canUseAi) {
      return await drafter.ruleBased.draftOutreach(opportunity, contact, context);
    }
    throw err;
  }
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
