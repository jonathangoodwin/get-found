#!/usr/bin/env node
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
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
import { renderMarkdownReport } from "./report/markdown.js";
import { ClaudeBriefDrafter, RuleBasedBriefDrafter, type BriefDrafter } from "./ai/brief.js";
import type { ContentBrief, CoreWebVitals, HealthFinding, Opportunity, SitemapStatus } from "./types.js";

const program = new Command();

program
  .name("get-found")
  .description("Crawl your site and competitors, pull Search Console data, and produce a ranked content-gap report.");

program
  .command("run")
  .requiredOption("--site <domain>", "your domain, e.g. example.com")
  .option("--competitors <domains>", "comma-separated competitor domains", "")
  .option("--gsc-site-url <url>", 'Search Console property, e.g. "https://example.com/" or "sc-domain:example.com"')
  .option("--max-pages <n>", "max pages to crawl per domain", "200")
  .option("--out <file>", "output markdown file (defaults to stdout)")
  .option("--briefs <n>", "draft content briefs for the top N opportunities (0 to skip)", "10")
  .option("--no-ai", "never use Claude for briefs, even if ANTHROPIC_API_KEY is set")
  .option("--business-context <text>", "one-line business context to sharpen AI-drafted briefs")
  .option("--history-dir <path>", "where run snapshots are saved for diffing against future runs", DEFAULT_HISTORY_DIR)
  .option("--no-save-history", "don't save this run's snapshot (still diffs against prior runs if any exist)")
  .option("--thin-content-words <n>", "word-count floor below which a page is flagged as thin content", "300")
  .option("--cwv-pages <n>", "how many of the own site's pages to pull Core Web Vitals for", "5")
  .action(async (opts) => {
    const maxPages = Number(opts.maxPages);
    const historyStore = new FileHistoryStore(opts.historyDir);
    const previousReport = await historyStore.loadLatest(opts.site);
    const competitorDomains: string[] = opts.competitors
      ? opts.competitors.split(",").map((d: string) => d.trim()).filter(Boolean)
      : [];

    console.error(`Crawling ${opts.site}...`);
    const ownSite = await crawlSite(opts.site, { maxPages });

    const competitorSites = [];
    for (const domain of competitorDomains) {
      console.error(`Crawling ${domain}...`);
      competitorSites.push(await crawlSite(domain, { maxPages }));
    }

    const healthFindings: HealthFinding[] = runHealthChecks(ownSite, {
      thinContentWordCount: Number(opts.thinContentWords),
    });

    let strikingDistance: Opportunity[] = [];
    let rankingWatch: Opportunity[] = [];
    let sitemapStatuses: SitemapStatus[] = [];
    if (opts.gscSiteUrl) {
      const credentials = loadGscCredentialsFromEnv();
      if (!credentials) {
        console.error(
          "Warning: --gsc-site-url given but GSC_CLIENT_ID/GSC_CLIENT_SECRET/GSC_REFRESH_TOKEN are not set. Skipping Search Console analysis. See README for OAuth setup."
        );
      } else {
        console.error(`Fetching Search Console data for ${opts.gscSiteUrl}...`);
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
      const cwvPages = ownSite.pages.slice(0, Number(opts.cwvPages)).map((p) => p.url);
      if (cwvPages.length > 0) {
        console.error(`Fetching Core Web Vitals for ${cwvPages.length} page(s)...`);
        coreWebVitals = await fetchCoreWebVitalsForUrls(cwvPages, cruxCredentials);
      }
    }

    let contentGap = computeContentGap(ownSite, competitorSites);

    const dataForSeoCredentials = loadDataForSeoCredentialsFromEnv();
    if (dataForSeoCredentials && contentGap.length > 0) {
      console.error(`Fetching keyword volume for ${contentGap.length} topics from DataForSEO...`);
      const provider = new DataForSeoProvider(dataForSeoCredentials);
      const metrics = await provider.getSearchVolume(contentGap.map((o) => o.topic));
      const metricsByKeyword = new Map(metrics.map((m) => [m.keyword.toLowerCase(), m]));
      contentGap = applyKeywordVolume(contentGap, metricsByKeyword);
    }

    const report = buildGapReport(opts.site, competitorDomains, [
      ...contentGap,
      ...strikingDistance,
      ...rankingWatch,
    ]);

    const diff: SnapshotDiff | null = previousReport ? diffReports(previousReport, report) : null;
    if (opts.saveHistory !== false) {
      await historyStore.save(report);
    }

    const briefLimit = Number(opts.briefs);
    // ranking-watch entries are visibility, not something to draft a content brief for.
    const briefableOpportunities = report.opportunities.filter((o) => o.kind !== "ranking-watch");
    const briefs = await draftBriefs(briefableOpportunities.slice(0, briefLimit), {
      useAi: opts.ai !== false,
      businessContext: opts.businessContext,
    });

    const markdown = renderMarkdownReport(report, { briefs, diff, healthFindings, sitemapStatuses, coreWebVitals });

    if (opts.out) {
      await writeFile(opts.out, markdown, "utf-8");
      console.error(`Report written to ${opts.out}`);
    } else {
      console.log(markdown);
    }
  });

program.parseAsync(process.argv);

async function draftBriefs(
  opportunities: Opportunity[],
  opts: { useAi: boolean; businessContext?: string }
): Promise<Map<string, ContentBrief>> {
  const ruleBased = new RuleBasedBriefDrafter();
  const canUseAi = opts.useAi && Boolean(process.env.ANTHROPIC_API_KEY);
  const primary: BriefDrafter = canUseAi
    ? new ClaudeBriefDrafter({ businessContext: opts.businessContext })
    : ruleBased;

  if (opportunities.length > 0) {
    console.error(`Drafting ${opportunities.length} content brief(s)${canUseAi ? " with Claude" : " (rule-based — no ANTHROPIC_API_KEY set)"}...`);
  }

  const briefs = new Map<string, ContentBrief>();
  for (const opportunity of opportunities) {
    try {
      briefs.set(opportunity.topic, await primary.draftBrief(opportunity));
    } catch (err) {
      if (canUseAi) {
        console.error(`Claude brief drafting failed for "${opportunity.topic}", falling back to rule-based: ${(err as Error).message}`);
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
