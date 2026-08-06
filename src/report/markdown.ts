import type { ContentBrief, GapReport, Opportunity } from "../types.js";

export function renderMarkdownReport(report: GapReport, briefs?: Map<string, ContentBrief>): string {
  const gapOpportunities = report.opportunities.filter((o) => o.kind === "content-gap");
  const strikingDistance = report.opportunities.filter((o) => o.kind === "striking-distance");

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
    "",
  ];

  if (briefs && briefs.size > 0) {
    lines.push("## Content briefs", "");
    for (const opportunity of report.opportunities) {
      const brief = briefs.get(opportunity.topic);
      if (brief) lines.push(renderBrief(brief), "");
    }
  }

  return lines.join("\n");
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
