import type { SnapshotDiff } from "../history/diff.js";
import type {
  ContactChannel,
  CoreWebVitals,
  GapReport,
  HealthFinding,
  KeywordTrendSignal,
  Opportunity,
  SitemapStatus,
  TrendSignal,
} from "../types.js";
import type { ReportSection } from "./config.js";

/**
 * Deliberately not `@slack/types`' `KnownBlock` — this stays a plain
 * structural type so format.ts has zero dependency on the Slack SDK and is
 * unit-testable without it. It's still valid Block Kit JSON; the wiring
 * layer (bot.ts) hands it to the SDK as-is.
 */
export interface SlackBlock {
  type: string;
  [key: string]: unknown;
}

export interface ReportBlocksInput {
  report: GapReport;
  diff?: SnapshotDiff | null;
  healthFindings?: HealthFinding[];
  sitemapStatuses?: SitemapStatus[];
  coreWebVitals?: CoreWebVitals[];
  contacts?: Map<string, ContactChannel>;
  trendSignals?: TrendSignal[];
}

const TOP_N = 5;

/**
 * Renders a report (and optionally a diff) as Slack Block Kit blocks.
 * `sections` filters which sections appear — used by the daily report,
 * which is user-configurable; `/run` and `/latest` pass no filter and show
 * everything available.
 */
export function formatReportBlocks(input: ReportBlocksInput, sections?: ReportSection[]): SlackBlock[] {
  const include = (section: ReportSection): boolean => !sections || sections.includes(section);
  const blocks: SlackBlock[] = [];

  blocks.push(header(`SEO report — ${input.report.ownDomain}`));
  blocks.push(
    context(
      `Generated ${input.report.generatedAt} · competitors: ${input.report.competitorDomains.join(", ") || "none"}`
    )
  );

  if (input.diff) {
    blocks.push(...diffBlocks(input.diff));
  }

  if (include("striking-distance")) {
    blocks.push(
      ...opportunitySectionBlocks(
        "Quick wins — striking distance",
        input.report.opportunities.filter((o) => o.kind === "striking-distance")
      )
    );
  }

  if (include("content-gap")) {
    blocks.push(
      ...opportunitySectionBlocks(
        "New content opportunities",
        input.report.opportunities.filter((o) => o.kind === "content-gap")
      )
    );
  }

  if (include("ranking-watch")) {
    blocks.push(
      ...opportunitySectionBlocks(
        "Tracked rankings",
        input.report.opportunities.filter((o) => o.kind === "ranking-watch")
      )
    );
  }

  if (include("link-gap")) {
    blocks.push(
      ...opportunitySectionBlocks(
        "Link building opportunities",
        input.report.opportunities.filter((o) => o.kind === "link-gap"),
        input.contacts
      )
    );
  }

  if (include("trends") && input.trendSignals) {
    blocks.push(...trendBlocks(input.trendSignals));
  }

  if (include("site-health") && input.healthFindings) {
    blocks.push(...healthBlocks(input.healthFindings));
  }

  if (include("sitemap") && input.sitemapStatuses) {
    blocks.push(...sitemapBlocks(input.sitemapStatuses));
  }

  if (include("core-web-vitals") && input.coreWebVitals) {
    blocks.push(...coreWebVitalsBlocks(input.coreWebVitals));
  }

  return blocks;
}

function diffBlocks(diff: SnapshotDiff): SlackBlock[] {
  const totalChanges = diff.newOpportunities.length + diff.resolvedOpportunities.length + diff.changedOpportunities.length;
  if (totalChanges === 0) {
    return [divider(), section("*Changes since last run*\nNo change since the last run.")];
  }

  const parts: string[] = [];
  if (diff.newOpportunities.length > 0) parts.push(`🆕 ${diff.newOpportunities.length} new`);
  if (diff.resolvedOpportunities.length > 0) parts.push(`✅ ${diff.resolvedOpportunities.length} resolved`);
  if (diff.changedOpportunities.length > 0) parts.push(`↕️ ${diff.changedOpportunities.length} changed`);

  return [divider(), section(`*Changes since last run*\n${parts.join(" · ")}`)];
}

function opportunitySectionBlocks(
  title: string,
  opportunities: Opportunity[],
  contacts?: Map<string, ContactChannel>
): SlackBlock[] {
  if (opportunities.length === 0) return [];

  const top = opportunities.slice(0, TOP_N);
  const lines = top.map((o) => {
    if (o.kind === "content-gap") {
      return `• *${o.topic}* — covered by ${o.competitorsCovering.join(", ") || "competitor(s)"}`;
    }
    if (o.kind === "link-gap") {
      const contactNote = contacts ? (contacts.has(o.topic) ? " · contact found" : " · no contact found") : "";
      return `• *${o.topic}* — links to ${o.competitorsCovering.join(", ") || "competitor(s)"}${contactNote}`;
    }
    return `• *${o.topic}* — position ${o.currentPosition ?? "—"}, ${o.impressions ?? 0} impressions`;
  });
  const remainder = opportunities.length - top.length;
  const more = remainder > 0 ? `\n_...and ${remainder} more_` : "";

  return [divider(), section(`*${title}* (${opportunities.length})\n${lines.join("\n")}${more}`)];
}

function trendBlocks(signals: TrendSignal[]): SlackBlock[] {
  if (signals.length === 0) return [];

  const top = signals.slice(0, TOP_N);
  const lines = top.map((s) => {
    const traffic = s.approxTraffic ? ` (${s.approxTraffic} searches)` : "";
    return `• *${s.topic}* is trending as "${s.matchedQuery}"${traffic}`;
  });
  const remainder = signals.length - top.length;
  const more = remainder > 0 ? `\n_...and ${remainder} more_` : "";

  return [divider(), section(`*Trending now* (${signals.length})\n${lines.join("\n")}${more}`)];
}

function healthBlocks(findings: HealthFinding[]): SlackBlock[] {
  if (findings.length === 0) {
    return [divider(), section("*Site health*\nNo issues found.")];
  }

  const counts = new Map<string, number>();
  for (const finding of findings) counts.set(finding.type, (counts.get(finding.type) ?? 0) + 1);
  const lines = [...counts.entries()].map(([type, count]) => `• ${type.replace(/-/g, " ")}: ${count}`);

  return [divider(), section(`*Site health* (${findings.length} issue${findings.length === 1 ? "" : "s"})\n${lines.join("\n")}`)];
}

function sitemapBlocks(statuses: SitemapStatus[]): SlackBlock[] {
  if (statuses.length === 0) return [];

  const totalWarnings = statuses.reduce((sum, s) => sum + s.warnings, 0);
  const totalErrors = statuses.reduce((sum, s) => sum + s.errors, 0);

  return [
    divider(),
    section(`*Sitemap status*\n${statuses.length} sitemap(s) · ${totalWarnings} warning(s) · ${totalErrors} error(s)`),
  ];
}

function coreWebVitalsBlocks(vitals: CoreWebVitals[]): SlackBlock[] {
  if (vitals.length === 0) return [];

  const lines = vitals.map((v) => `• ${v.url}: LCP ${v.lcpMs ?? "—"}ms · INP ${v.inpMs ?? "—"}ms · CLS ${v.cls ?? "—"}`);

  return [divider(), section(`*Core Web Vitals*\n${lines.join("\n")}`)];
}

/**
 * Standalone formatter for trend-watch results — a separate pipeline from
 * the main GapReport (no site crawl involved), posted on its own schedule
 * rather than as a section of formatReportBlocks.
 */
export function formatTrendWatchBlocks(result: { checkedKeywords: string[]; signals: KeywordTrendSignal[] }): SlackBlock[] {
  const blocks: SlackBlock[] = [
    header("Google Trends keyword watch"),
    context(`Checked ${result.checkedKeywords.length} keyword(s): ${result.checkedKeywords.join(", ")}`),
  ];

  if (result.signals.length === 0) {
    blocks.push(divider(), section("No keyword cleared the spike threshold this check."));
    return blocks;
  }

  const lines = result.signals.map(
    (s) => `• *${s.keyword}* — ${s.baselineInterest.toFixed(0)} → ${s.recentInterest.toFixed(0)} (+${s.deltaPercent.toFixed(0)}%)`
  );
  blocks.push(divider(), section(`*Spiking now* (${result.signals.length})\n${lines.join("\n")}`));
  return blocks;
}

function header(text: string): SlackBlock {
  return { type: "header", text: { type: "plain_text", text: truncate(text, 150) } };
}

function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text: truncate(text, 3000) } };
}

function divider(): SlackBlock {
  return { type: "divider" };
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
