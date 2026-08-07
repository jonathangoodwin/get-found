import { describe, expect, it } from "vitest";
import { renderMarkdownReport } from "../../src/report/markdown.js";
import type { SnapshotDiff } from "../../src/history/diff.js";
import type { CoreWebVitals, GapReport, HealthFinding, Opportunity, SitemapStatus } from "../../src/types.js";

function opportunity(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    kind: "content-gap",
    topic: "memory care pricing",
    competitorsCovering: ["comp.com"],
    ownUrl: null,
    currentPosition: null,
    impressions: null,
    opportunityScore: 1,
    ...overrides,
  };
}

function report(opportunities: Opportunity[] = []): GapReport {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    ownDomain: "ours.com",
    competitorDomains: ["comp.com"],
    opportunities,
  };
}

describe("renderMarkdownReport — diff section", () => {
  it("omits the changes section entirely when no diff is passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("Changes since last run");
  });

  it("reports 'no change' when the diff is empty", () => {
    const diff: SnapshotDiff = { newOpportunities: [], resolvedOpportunities: [], changedOpportunities: [] };
    const markdown = renderMarkdownReport(report(), { diff });
    expect(markdown).toContain("## Changes since last run");
    expect(markdown).toContain("No change since the last run.");
  });

  it("lists new, resolved, and changed opportunities", () => {
    const diff: SnapshotDiff = {
      newOpportunities: [opportunity({ topic: "va aid and attendance" })],
      resolvedOpportunities: [opportunity({ topic: "assisted living cost" })],
      changedOpportunities: [
        {
          kind: "striking-distance",
          topic: "memory care near me",
          previousScore: 100,
          currentScore: 200,
          previousPosition: 14,
          currentPosition: 9,
        },
      ],
    };

    const markdown = renderMarkdownReport(report(), { diff });

    expect(markdown).toContain("**New (1):**");
    expect(markdown).toContain("- va aid and attendance");
    expect(markdown).toContain("**Resolved (1):**");
    expect(markdown).toContain("- assisted living cost");
    expect(markdown).toContain("**Changed (1):**");
    expect(markdown).toContain("memory care near me: score 100 → 200 — position 14 → 9");
  });
});

describe("renderMarkdownReport — ranking watch", () => {
  it("omits the section when there are no ranking-watch opportunities", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Tracked rankings");
  });

  it("renders a table of tracked rankings", () => {
    const markdown = renderMarkdownReport(
      report([
        opportunity({ kind: "ranking-watch", topic: "memory care near me", ownUrl: "/memory-care", currentPosition: 3, impressions: 5000, opportunityScore: 5000 }),
      ])
    );
    expect(markdown).toContain("## Tracked rankings");
    expect(markdown).toContain("memory care near me");
    expect(markdown).toContain("/memory-care");
  });
});

describe("renderMarkdownReport — site health", () => {
  it("omits the section when healthFindings is not passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Site health");
  });

  it("reports no issues found for an empty findings list", () => {
    const markdown = renderMarkdownReport(report(), { healthFindings: [] });
    expect(markdown).toContain("## Site health");
    expect(markdown).toContain("No issues found.");
  });

  it("groups findings by type with counts and lists each one", () => {
    const findings: HealthFinding[] = [
      { type: "missing-title", url: "https://ours.com/a", detail: "No <title> tag found." },
      { type: "missing-title", url: "https://ours.com/b", detail: "No <title> tag found." },
      { type: "broken-link", url: "https://ours.com/dead", detail: "404" },
    ];
    const markdown = renderMarkdownReport(report(), { healthFindings: findings });

    expect(markdown).toContain("| missing title | 2 |");
    expect(markdown).toContain("| broken link | 1 |");
    expect(markdown).toContain("https://ours.com/a — No <title> tag found.");
    expect(markdown).toContain("https://ours.com/dead — 404");
  });

  it("truncates long lists per finding type", () => {
    const findings: HealthFinding[] = Array.from({ length: 20 }, (_, i) => ({
      type: "missing-title" as const,
      url: `https://ours.com/${i}`,
      detail: "No <title> tag found.",
    }));
    const markdown = renderMarkdownReport(report(), { healthFindings: findings });
    expect(markdown).toContain("_...and 5 more_");
  });
});

describe("renderMarkdownReport — sitemap status", () => {
  it("omits the section when sitemapStatuses is not passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Sitemap status");
  });

  it("says no data available for an empty list", () => {
    const markdown = renderMarkdownReport(report(), { sitemapStatuses: [] });
    expect(markdown).toContain("_No Search Console sitemap data available._");
  });

  it("renders submitted/indexed counts per sitemap content type", () => {
    const statuses: SitemapStatus[] = [
      {
        path: "https://ours.com/sitemap.xml",
        lastDownloaded: "2026-08-01T00:00:00.000Z",
        isPending: false,
        warnings: 1,
        errors: 0,
        contents: [{ type: "web", submitted: 120, indexed: 115 }],
      },
    ];
    const markdown = renderMarkdownReport(report(), { sitemapStatuses: statuses });
    expect(markdown).toContain("https://ours.com/sitemap.xml | web | 120 | 115 | 1 | 0");
  });
});

describe("renderMarkdownReport — Core Web Vitals", () => {
  it("omits the section when coreWebVitals is not passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Core Web Vitals");
  });

  it("says no data available for an empty list", () => {
    const markdown = renderMarkdownReport(report(), { coreWebVitals: [] });
    expect(markdown).toContain("_No Chrome UX Report data available");
  });

  it("marks good/needs-improvement/poor per Google's thresholds", () => {
    const vitals: CoreWebVitals[] = [{ url: "https://ours.com/", lcpMs: 2000, inpMs: 300, cls: 0.3 }];
    const markdown = renderMarkdownReport(report(), { coreWebVitals: vitals });
    expect(markdown).toContain("🟢 2000ms");
    expect(markdown).toContain("🟡 300ms");
    expect(markdown).toContain("🔴 0.3");
  });

  it("shows an em-dash for missing metric values", () => {
    const vitals: CoreWebVitals[] = [{ url: "https://ours.com/", lcpMs: null, inpMs: null, cls: null }];
    const markdown = renderMarkdownReport(report(), { coreWebVitals: vitals });
    expect(markdown).toContain("| https://ours.com/ | — | — | — |");
  });
});
