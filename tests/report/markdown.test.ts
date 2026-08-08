import { describe, expect, it } from "vitest";
import { renderMarkdownReport } from "../../src/report/markdown.js";
import type { SnapshotDiff } from "../../src/history/diff.js";
import type {
  ContactChannel,
  CoreWebVitals,
  GapReport,
  HealthFinding,
  Opportunity,
  OutreachDraft,
  SitemapStatus,
} from "../../src/types.js";

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

describe("renderMarkdownReport — link gap", () => {
  it("omits the section when there are no link-gap opportunities", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("Link building opportunities");
  });

  it("renders a table of link-gap domains with covering competitors and score", () => {
    const markdown = renderMarkdownReport(
      report([
        opportunity({ kind: "link-gap", topic: "senior-resources.org", competitorsCovering: ["compa.com", "compb.com"], opportunityScore: 500 }),
      ])
    );
    expect(markdown).toContain("## Link building opportunities (backlink gap)");
    expect(markdown).toContain("senior-resources.org | compa.com, compb.com");
    expect(markdown).toContain("500");
  });

  it("shows the discovered contact when a contacts map is passed", () => {
    const contacts = new Map<string, ContactChannel>([
      ["senior-resources.org", { url: "https://senior-resources.org/", email: "info@senior-resources.org", contactPageUrl: null, socialLinks: [] }],
    ]);
    const markdown = renderMarkdownReport(
      report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      { contacts }
    );
    expect(markdown).toContain("info@senior-resources.org");
  });

  it("shows an em-dash when no contact was found for a target", () => {
    const markdown = renderMarkdownReport(
      report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      { contacts: new Map() }
    );
    expect(markdown).toContain("senior-resources.org | comp.com | — |");
  });
});

describe("renderMarkdownReport — trending now", () => {
  it("omits the section when no trendSignals are passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Trending now");
  });

  it("omits the section when trendSignals is an empty list", () => {
    const markdown = renderMarkdownReport(report(), { trendSignals: [] });
    expect(markdown).not.toContain("## Trending now");
  });

  it("renders the matched topic, trending query, and approx traffic", () => {
    const markdown = renderMarkdownReport(report(), {
      trendSignals: [
        { topic: "memory care pricing", matchedQuery: "Pricing for Memory Care", approxTraffic: "2000+", newsItems: [] },
      ],
    });
    expect(markdown).toContain("## Trending now");
    expect(markdown).toContain('**memory care pricing** is trending right now as "Pricing for Memory Care" (2000+ searches)');
  });

  it("includes a linked news item as evidence when present", () => {
    const markdown = renderMarkdownReport(report(), {
      trendSignals: [
        {
          topic: "memory care pricing",
          matchedQuery: "memory care pricing",
          approxTraffic: null,
          newsItems: [{ title: "Big story", url: "https://example.com/a", source: "Example News" }],
        },
      ],
    });
    expect(markdown).toContain("[Big story](https://example.com/a) (Example News)");
  });
});

describe("renderMarkdownReport — outreach drafts", () => {
  it("omits the section when outreachDrafts is not passed", () => {
    const markdown = renderMarkdownReport(report());
    expect(markdown).not.toContain("## Outreach drafts");
  });

  it("includes the never-auto-sent disclaimer", () => {
    const drafts = new Map<string, OutreachDraft>([
      ["senior-resources.org", { targetDomain: "senior-resources.org", subject: "Link opportunity", message: "Hi there", source: "ai-drafted" }],
    ]);
    const markdown = renderMarkdownReport(
      report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      { outreachDrafts: drafts }
    );
    expect(markdown).toContain("get-found never sends outreach on its own");
  });

  it("renders the draft subject and message, and notes when no contact was found", () => {
    const drafts = new Map<string, OutreachDraft>([
      ["senior-resources.org", { targetDomain: "senior-resources.org", subject: "Link opportunity", message: "Hi there", source: "ai-drafted" }],
    ]);
    const markdown = renderMarkdownReport(
      report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      { outreachDrafts: drafts, contacts: new Map() }
    );
    expect(markdown).toContain("### senior-resources.org");
    expect(markdown).toContain("AI-drafted — review before sending");
    expect(markdown).toContain("**Subject:** Link opportunity");
    expect(markdown).toContain("Hi there");
    expect(markdown).toContain("none found — verify manually");
  });

  it("shows the contact email when one was found", () => {
    const drafts = new Map<string, OutreachDraft>([
      ["senior-resources.org", { targetDomain: "senior-resources.org", subject: "s", message: "m", source: "rule-based" }],
    ]);
    const contacts = new Map<string, ContactChannel>([
      ["senior-resources.org", { url: "https://senior-resources.org/", email: "info@senior-resources.org", contactPageUrl: null, socialLinks: [] }],
    ]);
    const markdown = renderMarkdownReport(
      report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      { outreachDrafts: drafts, contacts }
    );
    expect(markdown).toContain("**Contact:** info@senior-resources.org");
  });
});
