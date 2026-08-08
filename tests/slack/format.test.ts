import { describe, expect, it } from "vitest";
import { formatReportBlocks } from "../../src/slack/format.js";
import type { SnapshotDiff } from "../../src/history/diff.js";
import type { ContactChannel, CoreWebVitals, GapReport, HealthFinding, Opportunity, SitemapStatus } from "../../src/types.js";

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

function textOf(blocks: ReturnType<typeof formatReportBlocks>): string {
  return blocks
    .map((b) => {
      if (b.type === "header") return (b.text as { text: string }).text;
      if (b.type === "section") return (b.text as { text: string }).text;
      if (b.type === "context") return (b.elements as Array<{ text: string }>).map((e) => e.text).join(" ");
      return "";
    })
    .join("\n");
}

describe("formatReportBlocks", () => {
  it("always includes a header naming the domain", () => {
    const blocks = formatReportBlocks({ report: report() });
    expect(blocks[0]).toMatchObject({ type: "header" });
    expect(textOf(blocks)).toContain("ours.com");
  });

  it("omits the diff block when no diff is passed", () => {
    const blocks = formatReportBlocks({ report: report() });
    expect(textOf(blocks)).not.toContain("Changes since last run");
  });

  it("reports no change for an empty diff", () => {
    const diff: SnapshotDiff = { newOpportunities: [], resolvedOpportunities: [], changedOpportunities: [] };
    const blocks = formatReportBlocks({ report: report(), diff });
    expect(textOf(blocks)).toContain("No change since the last run.");
  });

  it("summarizes new/resolved/changed counts", () => {
    const diff: SnapshotDiff = {
      newOpportunities: [opportunity()],
      resolvedOpportunities: [opportunity(), opportunity()],
      changedOpportunities: [],
    };
    const blocks = formatReportBlocks({ report: report(), diff });
    const text = textOf(blocks);
    expect(text).toContain("🆕 1 new");
    expect(text).toContain("✅ 2 resolved");
  });

  it("lists content-gap opportunities with their covering competitors", () => {
    const blocks = formatReportBlocks({
      report: report([opportunity({ topic: "va aid and attendance", competitorsCovering: ["a.com", "b.com"] })]),
    });
    const text = textOf(blocks);
    expect(text).toContain("va aid and attendance");
    expect(text).toContain("a.com, b.com");
  });

  it("caps the listed opportunities at 5 and notes the remainder", () => {
    const opportunities = Array.from({ length: 8 }, (_, i) => opportunity({ topic: `topic ${i}` }));
    const blocks = formatReportBlocks({ report: report(opportunities) });
    expect(textOf(blocks)).toContain("_...and 3 more_");
  });

  it("omits an opportunity section entirely when there's nothing of that kind", () => {
    const blocks = formatReportBlocks({ report: report([opportunity({ kind: "striking-distance" })]) });
    expect(textOf(blocks)).not.toContain("New content opportunities");
  });

  it("filters sections when a sections list is passed", () => {
    const blocks = formatReportBlocks(
      { report: report([opportunity({ kind: "content-gap" }), opportunity({ kind: "striking-distance" })]) },
      ["content-gap"]
    );
    const text = textOf(blocks);
    expect(text).toContain("New content opportunities");
    expect(text).not.toContain("striking distance");
  });

  it("summarizes site health findings by type with counts", () => {
    const findings: HealthFinding[] = [
      { type: "missing-title", url: "https://ours.com/a", detail: "x" },
      { type: "missing-title", url: "https://ours.com/b", detail: "x" },
      { type: "broken-link", url: "https://ours.com/c", detail: "x" },
    ];
    const blocks = formatReportBlocks({ report: report(), healthFindings: findings });
    const text = textOf(blocks);
    expect(text).toContain("missing title: 2");
    expect(text).toContain("broken link: 1");
  });

  it("says no issues found for an empty health findings list", () => {
    const blocks = formatReportBlocks({ report: report(), healthFindings: [] });
    expect(textOf(blocks)).toContain("No issues found.");
  });

  it("summarizes sitemap warnings and errors across sitemaps", () => {
    const statuses: SitemapStatus[] = [
      { path: "/sitemap-1.xml", lastDownloaded: null, isPending: false, warnings: 2, errors: 1, contents: [] },
      { path: "/sitemap-2.xml", lastDownloaded: null, isPending: false, warnings: 0, errors: 0, contents: [] },
    ];
    const blocks = formatReportBlocks({ report: report(), sitemapStatuses: statuses });
    const text = textOf(blocks);
    expect(text).toContain("2 sitemap(s)");
    expect(text).toContain("2 warning(s)");
    expect(text).toContain("1 error(s)");
  });

  it("lists Core Web Vitals per URL", () => {
    const vitals: CoreWebVitals[] = [{ url: "https://ours.com/", lcpMs: 2100, inpMs: 180, cls: 0.05 }];
    const blocks = formatReportBlocks({ report: report(), coreWebVitals: vitals });
    const text = textOf(blocks);
    expect(text).toContain("LCP 2100ms");
    expect(text).toContain("INP 180ms");
    expect(text).toContain("CLS 0.05");
  });
});

describe("formatReportBlocks — link gap", () => {
  it("lists link-gap domains with the competitors they link to", () => {
    const blocks = formatReportBlocks({
      report: report([opportunity({ kind: "link-gap", topic: "senior-resources.org", competitorsCovering: ["compa.com"] })]),
    });
    const text = textOf(blocks);
    expect(text).toContain("Link building opportunities");
    expect(text).toContain("senior-resources.org");
    expect(text).toContain("links to compa.com");
  });

  it("notes when a contact was found for a target", () => {
    const contacts = new Map<string, ContactChannel>([
      ["senior-resources.org", { url: "https://senior-resources.org/", email: "info@senior-resources.org", contactPageUrl: null, socialLinks: [] }],
    ]);
    const blocks = formatReportBlocks({
      report: report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      contacts,
    });
    expect(textOf(blocks)).toContain("contact found");
  });

  it("notes when no contact was found for a target", () => {
    const blocks = formatReportBlocks({
      report: report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
      contacts: new Map(),
    });
    expect(textOf(blocks)).toContain("no contact found");
  });

  it("omits the contact note entirely when no contacts map is passed", () => {
    const blocks = formatReportBlocks({
      report: report([opportunity({ kind: "link-gap", topic: "senior-resources.org" })]),
    });
    const text = textOf(blocks);
    expect(text).not.toContain("contact found");
    expect(text).not.toContain("no contact found");
  });

  it("respects the sections filter for link-gap", () => {
    const blocks = formatReportBlocks(
      { report: report([opportunity({ kind: "link-gap" }), opportunity({ kind: "content-gap" })]) },
      ["content-gap"]
    );
    const text = textOf(blocks);
    expect(text).toContain("New content opportunities");
    expect(text).not.toContain("Link building opportunities");
  });
});
