import type { SnapshotDiff } from "../history/diff.js";
import type {
  BrokenLinkDiagnosis,
  ContactChannel,
  ContentBrief,
  CoreWebVitals,
  GapReport,
  HealthFinding,
  KeywordTrendSignal,
  Opportunity,
  OutreachDraft,
  SitemapStatus,
  TrendSignal,
} from "../types.js";

export interface RenderReportOptions {
  briefs?: Map<string, ContentBrief>;
  diff?: SnapshotDiff | null;
  healthFindings?: HealthFinding[];
  sitemapStatuses?: SitemapStatus[];
  coreWebVitals?: CoreWebVitals[];
  contacts?: Map<string, ContactChannel>;
  outreachDrafts?: Map<string, OutreachDraft>;
  trendSignals?: TrendSignal[];
  brokenLinkDiagnoses?: BrokenLinkDiagnosis[];
}

export function renderMarkdownReport(report: GapReport, options: RenderReportOptions = {}): string {
  const { briefs, diff, healthFindings, sitemapStatuses, coreWebVitals, contacts, outreachDrafts, trendSignals, brokenLinkDiagnoses } =
    options;

  const gapOpportunities = report.opportunities.filter((o) => o.kind === "content-gap");
  const strikingDistance = report.opportunities.filter((o) => o.kind === "striking-distance");
  const rankingWatch = report.opportunities.filter((o) => o.kind === "ranking-watch");
  const linkGap = report.opportunities.filter((o) => o.kind === "link-gap");

  const lines: string[] = [
    `# SEO Content Gap Report — ${report.ownDomain}`,
    "",
    `Generated ${report.generatedAt}`,
    `Competitors analyzed: ${report.competitorDomains.join(", ") || "none"}`,
    "",
    "> AI-drafted sections (if any) are labeled and must be reviewed before publishing. Google's",
    "> quality guidance treats unreviewed AI content as a spam risk — see Search Quality Rater",
    "> Guidelines. Deterministic sections below are structural facts, not opinions.",
    "",
  ];

  if (diff) {
    lines.push(renderDiffSection(diff), "");
  }

  lines.push(
    "## Quick wins — striking distance (page 2 queries)",
    "",
    strikingDistance.length === 0
      ? "_No striking-distance queries found. Connect Google Search Console to populate this section._"
      : renderStrikingDistanceTable(strikingDistance),
    "",
    "## New content opportunities (competitor coverage gap)",
    "",
    gapOpportunities.length === 0
      ? "_No content gaps found against the given competitor set._"
      : renderGapTable(gapOpportunities),
    ""
  );

  if (rankingWatch.length > 0) {
    lines.push("## Tracked rankings", "", renderRankingWatchTable(rankingWatch), "");
  }

  if (linkGap.length > 0) {
    lines.push("## Link building opportunities (backlink gap)", "", renderLinkGapTable(linkGap, contacts), "");
  }

  if (trendSignals && trendSignals.length > 0) {
    lines.push("## Trending now", "", renderTrendSignals(trendSignals), "");
  }

  if (healthFindings) {
    lines.push(renderHealthSection(healthFindings), "");
  }

  if (brokenLinkDiagnoses && brokenLinkDiagnoses.length > 0) {
    lines.push(renderBrokenLinkDiagnosisSection(brokenLinkDiagnoses), "");
  }

  if (sitemapStatuses) {
    lines.push(renderSitemapSection(sitemapStatuses), "");
  }

  if (coreWebVitals) {
    lines.push(renderCoreWebVitalsSection(coreWebVitals), "");
  }

  if (briefs && briefs.size > 0) {
    lines.push("## Content briefs", "");
    for (const opportunity of report.opportunities) {
      const brief = briefs.get(opportunity.topic);
      if (brief) lines.push(renderBrief(brief), "");
    }
  }

  if (outreachDrafts && outreachDrafts.size > 0) {
    lines.push(
      "## Outreach drafts",
      "",
      "> Every message below is a **draft only** — get-found never sends outreach on its own. Review, personalize, and send these yourself.",
      ""
    );
    for (const opportunity of linkGap) {
      const draft = outreachDrafts.get(opportunity.topic);
      if (draft) lines.push(renderOutreachDraft(draft, contacts?.get(opportunity.topic) ?? null), "");
    }
  }

  return lines.join("\n");
}

function renderDiffSection(diff: SnapshotDiff): string {
  if (diff.newOpportunities.length === 0 && diff.resolvedOpportunities.length === 0 && diff.changedOpportunities.length === 0) {
    return "## Changes since last run\n\nNo change since the last run.";
  }

  const lines = ["## Changes since last run", ""];

  if (diff.newOpportunities.length > 0) {
    lines.push(
      `**New (${diff.newOpportunities.length}):**`,
      ...diff.newOpportunities.map((o) => `- ${o.topic}`),
      ""
    );
  }
  if (diff.resolvedOpportunities.length > 0) {
    lines.push(
      `**Resolved (${diff.resolvedOpportunities.length}):**`,
      ...diff.resolvedOpportunities.map((o) => `- ${o.topic}`),
      ""
    );
  }
  if (diff.changedOpportunities.length > 0) {
    lines.push(
      `**Changed (${diff.changedOpportunities.length}):**`,
      ...diff.changedOpportunities.map((c) => {
        const position =
          c.previousPosition !== c.currentPosition ? ` — position ${c.previousPosition ?? "—"} → ${c.currentPosition ?? "—"}` : "";
        return `- ${c.topic}: score ${c.previousScore} → ${c.currentScore}${position}`;
      }),
      ""
    );
  }

  return lines.join("\n").trimEnd();
}

function renderBrief(brief: ContentBrief): string {
  return [
    `### ${brief.topic}`,
    `_${brief.source === "ai-drafted" ? "AI-drafted — review before use" : "rule-based placeholder"}_`,
    "",
    `**Primary keyword:** ${brief.primaryKeyword}`,
    brief.secondaryKeywords.length > 0 ? `**Secondary keywords:** ${brief.secondaryKeywords.join(", ")}` : null,
    `**Search intent:** ${brief.searchIntent}`,
    brief.suggestedHeadings.length > 0
      ? `**Suggested headings:**\n${brief.suggestedHeadings.map((h) => `- ${h}`).join("\n")}`
      : null,
    brief.questionsToAnswer.length > 0
      ? `**Questions to answer:**\n${brief.questionsToAnswer.map((q) => `- ${q}`).join("\n")}`
      : null,
    `**Notes:** ${brief.notes}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function renderStrikingDistanceTable(opportunities: Opportunity[]): string {
  const header = "| Query | Page | Position | Impressions | Score |\n|---|---|---|---|---|";
  const rows = opportunities.map(
    (o) => `| ${o.topic} | ${o.ownUrl ?? ""} | ${o.currentPosition ?? ""} | ${o.impressions ?? ""} | ${o.opportunityScore.toFixed(0)} |`
  );
  return [header, ...rows].join("\n");
}

function renderGapTable(opportunities: Opportunity[]): string {
  const header = "| Topic | Covered by | Score |\n|---|---|---|";
  const rows = opportunities.map(
    (o) => `| ${o.topic} | ${o.competitorsCovering.join(", ")} | ${o.opportunityScore} |`
  );
  return [header, ...rows].join("\n");
}

function renderLinkGapTable(opportunities: Opportunity[], contacts?: Map<string, ContactChannel>): string {
  const header = "| Domain | Links to competitor(s) | Contact | Score |\n|---|---|---|---|";
  const rows = opportunities.map((o) => {
    const contact = contacts?.get(o.topic);
    const contactCell = contact
      ? [contact.email, contact.contactPageUrl, ...contact.socialLinks.slice(0, 1)].filter(Boolean)[0] ?? "found"
      : "—";
    return `| ${o.topic} | ${o.competitorsCovering.join(", ")} | ${contactCell} | ${o.opportunityScore} |`;
  });
  return [header, ...rows].join("\n");
}

function renderOutreachDraft(draft: OutreachDraft, contact: ContactChannel | null): string {
  return [
    `### ${draft.targetDomain}`,
    `_${draft.source === "ai-drafted" ? "AI-drafted — review before sending" : "rule-based placeholder"}_`,
    "",
    contact?.email ? `**Contact:** ${contact.email}` : null,
    contact?.contactPageUrl && !contact.email ? `**Contact page:** ${contact.contactPageUrl}` : null,
    !contact ? "**Contact:** none found — verify manually before reaching out." : null,
    `**Subject:** ${draft.subject}`,
    "",
    draft.message,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * Standalone report for `get-found trends-watch` — a different pipeline
 * from the main SEO report (no site crawl, no GapReport), so it gets its
 * own top-level renderer rather than a section inside renderMarkdownReport.
 */
export function renderTrendWatchReport(result: {
  checkedKeywords: string[];
  signals: KeywordTrendSignal[];
  failedKeywordCount: number;
  endpointHealthy: boolean;
}): string {
  const lines: string[] = ["# Google Trends keyword watch", ""];

  if (!result.endpointHealthy) {
    lines.push(
      `> ⚠️ **The Google Trends endpoint looks broken** — ${result.failedKeywordCount}/${result.checkedKeywords.length} keyword lookup(s) failed. ` +
        "This is an undocumented endpoint that can change shape without notice (see README). Results below may be incomplete.",
      ""
    );
  }

  lines.push(`Checked ${result.checkedKeywords.length} keyword(s): ${result.checkedKeywords.join(", ")}`, "");

  if (result.signals.length === 0) {
    lines.push("_No keyword cleared the spike threshold this check._");
    return lines.join("\n");
  }

  lines.push("| Keyword | Baseline interest | Recent interest | Change |", "|---|---|---|---|");
  for (const signal of result.signals) {
    lines.push(
      `| ${signal.keyword} | ${signal.baselineInterest.toFixed(1)} | ${signal.recentInterest.toFixed(1)} | +${signal.deltaPercent.toFixed(0)}% |`
    );
  }

  return lines.join("\n");
}

function renderTrendSignals(signals: TrendSignal[]): string {
  const lines = signals.map((s) => {
    const traffic = s.approxTraffic ? ` (${s.approxTraffic} searches)` : "";
    const news = s.newsItems[0];
    const evidence = news ? ` — [${news.title}](${news.url})${news.source ? ` (${news.source})` : ""}` : "";
    return `- **${s.topic}** is trending right now as "${s.matchedQuery}"${traffic}${evidence}`;
  });
  return lines.join("\n");
}

function renderRankingWatchTable(opportunities: Opportunity[]): string {
  const header = "| Query | Page | Position | Impressions |\n|---|---|---|---|";
  const rows = opportunities.map(
    (o) => `| ${o.topic} | ${o.ownUrl ?? ""} | ${o.currentPosition ?? ""} | ${o.impressions ?? ""} |`
  );
  return [header, ...rows].join("\n");
}

const MAX_FINDINGS_LISTED_PER_TYPE = 15;

function renderHealthSection(findings: HealthFinding[]): string {
  if (findings.length === 0) return "## Site health\n\nNo issues found.";

  const byType = new Map<string, HealthFinding[]>();
  for (const finding of findings) {
    if (!byType.has(finding.type)) byType.set(finding.type, []);
    byType.get(finding.type)!.push(finding);
  }

  const lines = ["## Site health", "", "| Issue | Count |", "|---|---|"];
  for (const [type, items] of byType) {
    lines.push(`| ${humanize(type)} | ${items.length} |`);
  }
  lines.push("");

  for (const [type, items] of byType) {
    lines.push(`**${humanize(type)}**`, "");
    for (const item of items.slice(0, MAX_FINDINGS_LISTED_PER_TYPE)) {
      lines.push(`- ${item.url} — ${item.detail}`);
    }
    if (items.length > MAX_FINDINGS_LISTED_PER_TYPE) {
      lines.push(`- _...and ${items.length - MAX_FINDINGS_LISTED_PER_TYPE} more_`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

const MAX_ORPHANED_LISTED = 15;

function renderBrokenLinkDiagnosisSection(diagnoses: BrokenLinkDiagnosis[]): string {
  const linked = diagnoses.filter((d) => d.linkedFromPages.length > 0);
  const orphaned = diagnoses.filter((d) => d.linkedFromPages.length === 0);

  const lines = [
    "## Broken link diagnosis",
    "",
    `${linked.length} of ${diagnoses.length} broken URL(s) are actually linked from a live page — a real visitor could click into these. ` +
      `The other ${orphaned.length} are stale sitemap entries with no live click path (lower urgency: fix by pruning/regenerating the sitemap, not the pages).`,
    "",
  ];

  if (linked.length > 0) {
    lines.push(
      "**Linked from a live page — fix these first:**",
      "",
      "| Broken URL | Linked from | Suggested replacement |",
      "|---|---|---|"
    );
    for (const d of linked) {
      const from = d.linkedFromPages.length > 2 ? `${d.linkedFromPages.slice(0, 2).join(", ")}, +${d.linkedFromPages.length - 2} more` : d.linkedFromPages.join(", ");
      lines.push(`| ${d.url} | ${from} | ${d.suggestedReplacement ?? "_no confident match_"} |`);
    }
    lines.push("");
  }

  if (orphaned.length > 0) {
    lines.push("**Sitemap-only (no live page links to these):**", "");
    for (const d of orphaned.slice(0, MAX_ORPHANED_LISTED)) {
      lines.push(`- ${d.url}${d.suggestedReplacement ? ` — possible replacement: ${d.suggestedReplacement}` : ""}`);
    }
    if (orphaned.length > MAX_ORPHANED_LISTED) {
      lines.push(`- _...and ${orphaned.length - MAX_ORPHANED_LISTED} more_`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * A redirect map for the entries with a confident suggested replacement —
 * the deliverable someone with CMS/hosting access actually pastes into a
 * redirect manager (Yoast/RankMath's redirect tool, an .htaccess/nginx
 * rule, etc.). get-found never applies this itself — see the outreach
 * drafts' same draft-only rationale.
 */
export function renderRedirectMapCsv(diagnoses: BrokenLinkDiagnosis[]): string {
  const rows = diagnoses.filter((d) => d.suggestedReplacement !== null);
  const lines = ["old_url,new_url", ...rows.map((d) => `${csvField(d.url)},${csvField(d.suggestedReplacement!)}`)];
  return lines.join("\n");
}

function csvField(value: string): string {
  return value.includes(",") ? `"${value}"` : value;
}

function renderSitemapSection(statuses: SitemapStatus[]): string {
  if (statuses.length === 0) {
    return "## Sitemap status\n\n_No Search Console sitemap data available._";
  }

  const lines = [
    "## Sitemap status",
    "",
    "| Sitemap | Type | Submitted | Indexed | Warnings | Errors |",
    "|---|---|---|---|---|---|",
  ];
  for (const sitemap of statuses) {
    if (sitemap.contents.length === 0) {
      lines.push(`| ${sitemap.path} | — | — | — | ${sitemap.warnings} | ${sitemap.errors} |`);
    } else {
      for (const content of sitemap.contents) {
        lines.push(
          `| ${sitemap.path} | ${content.type} | ${content.submitted} | ${content.indexed} | ${sitemap.warnings} | ${sitemap.errors} |`
        );
      }
    }
  }
  return lines.join("\n");
}

const CWV_THRESHOLDS = {
  lcp: { goodMax: 2500, poorMin: 4000, unit: "ms" },
  inp: { goodMax: 200, poorMin: 500, unit: "ms" },
  cls: { goodMax: 0.1, poorMin: 0.25, unit: "" },
};

function renderCoreWebVitalsSection(vitals: CoreWebVitals[]): string {
  if (vitals.length === 0) {
    return "## Core Web Vitals\n\n_No Chrome UX Report data available (low-traffic pages don't get real-user data)._";
  }

  const lines = ["## Core Web Vitals", "", "| URL | LCP | INP | CLS |", "|---|---|---|---|"];
  for (const v of vitals) {
    lines.push(
      `| ${v.url} | ${formatVital(v.lcpMs, CWV_THRESHOLDS.lcp)} | ${formatVital(v.inpMs, CWV_THRESHOLDS.inp)} | ${formatVital(v.cls, CWV_THRESHOLDS.cls)} |`
    );
  }
  lines.push("", "_🟢 good · 🟡 needs improvement · 🔴 poor, per Google's Core Web Vitals thresholds._");
  return lines.join("\n");
}

function formatVital(value: number | null, thresholds: { goodMax: number; poorMin: number; unit: string }): string {
  if (value == null) return "—";
  const icon = value <= thresholds.goodMax ? "🟢" : value <= thresholds.poorMin ? "🟡" : "🔴";
  return `${icon} ${value}${thresholds.unit}`;
}

function humanize(type: string): string {
  return type.replace(/-/g, " ");
}
