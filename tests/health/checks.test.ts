import { describe, expect, it } from "vitest";
import { runHealthChecks } from "../../src/health/checks.js";
import type { PageRecord, SiteCrawlResult } from "../../src/types.js";

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url: "https://example.com/page",
    domain: "example.com",
    title: "A Page",
    metaDescription: "A description.",
    h1: ["A Page"],
    h2: [],
    h3: [],
    wordCount: 500,
    canonicalUrl: null,
    hasSchema: true,
    isNoindex: false,
    internalLinks: [],
    fetchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function site(pages: PageRecord[], failedUrls: string[] = []): SiteCrawlResult {
  return { domain: "example.com", pages, failedUrls, crawledAt: "2026-08-01T00:00:00.000Z" };
}

describe("runHealthChecks", () => {
  it("returns no findings for a clean page", () => {
    expect(runHealthChecks(site([page()]))).toEqual([]);
  });

  it("flags a failed URL as a broken link", () => {
    const findings = runHealthChecks(site([], ["https://example.com/dead"]));
    expect(findings).toEqual([
      { type: "broken-link", url: "https://example.com/dead", detail: expect.any(String) },
    ]);
  });

  it("flags a missing title", () => {
    const findings = runHealthChecks(site([page({ title: null })]));
    expect(findings.some((f) => f.type === "missing-title")).toBe(true);
  });

  it("flags duplicate titles across pages, once, listing both URLs", () => {
    const findings = runHealthChecks(
      site([
        page({ url: "https://example.com/a", title: "Same Title" }),
        page({ url: "https://example.com/b", title: "Same Title" }),
      ])
    );
    const duplicates = findings.filter((f) => f.type === "duplicate-title");
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0].detail).toContain("https://example.com/a");
    expect(duplicates[0].detail).toContain("https://example.com/b");
  });

  it("flags a missing meta description", () => {
    const findings = runHealthChecks(site([page({ metaDescription: null })]));
    expect(findings.some((f) => f.type === "missing-meta-description")).toBe(true);
  });

  it("flags duplicate meta descriptions across pages, once", () => {
    const findings = runHealthChecks(
      site([
        page({ url: "https://example.com/a", metaDescription: "Same desc" }),
        page({ url: "https://example.com/b", metaDescription: "Same desc" }),
      ])
    );
    expect(findings.filter((f) => f.type === "duplicate-meta-description")).toHaveLength(1);
  });

  it("flags a missing H1", () => {
    const findings = runHealthChecks(site([page({ h1: [] })]));
    expect(findings.some((f) => f.type === "missing-h1")).toBe(true);
  });

  it("flags multiple H1s", () => {
    const findings = runHealthChecks(site([page({ h1: ["First", "Second"] })]));
    expect(findings.some((f) => f.type === "multiple-h1")).toBe(true);
  });

  it("flags thin content below the word-count floor", () => {
    const findings = runHealthChecks(site([page({ wordCount: 50 })]));
    expect(findings.some((f) => f.type === "thin-content")).toBe(true);
  });

  it("respects a custom thin-content threshold", () => {
    const findings = runHealthChecks(site([page({ wordCount: 500 })]), { thinContentWordCount: 600 });
    expect(findings.some((f) => f.type === "thin-content")).toBe(true);
  });

  it("flags missing schema markup", () => {
    const findings = runHealthChecks(site([page({ hasSchema: false })]));
    expect(findings.some((f) => f.type === "missing-schema")).toBe(true);
  });

  it("flags a noindex page", () => {
    const findings = runHealthChecks(site([page({ isNoindex: true })]));
    expect(findings.some((f) => f.type === "noindex")).toBe(true);
  });

  it("does not flag distinct titles or meta descriptions as duplicates", () => {
    const findings = runHealthChecks(
      site([
        page({ url: "https://example.com/a", title: "Title A", metaDescription: "Desc A" }),
        page({ url: "https://example.com/b", title: "Title B", metaDescription: "Desc B" }),
      ])
    );
    expect(findings.filter((f) => f.type === "duplicate-title" || f.type === "duplicate-meta-description")).toEqual([]);
  });
});
