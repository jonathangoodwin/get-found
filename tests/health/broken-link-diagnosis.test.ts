import { describe, expect, it } from "vitest";
import { diagnoseBrokenLinks } from "../../src/health/broken-link-diagnosis.js";
import type { PageRecord, SiteCrawlResult } from "../../src/types.js";

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    url: "https://example.com/page",
    domain: "example.com",
    title: "A Page",
    metaDescription: null,
    h1: [],
    h2: [],
    h3: [],
    wordCount: 500,
    canonicalUrl: null,
    hasSchema: false,
    isNoindex: false,
    internalLinks: [],
    fetchedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function site(pages: PageRecord[], failedUrls: string[] = []): SiteCrawlResult {
  return { domain: "example.com", pages, failedUrls, crawledAt: "2026-08-01T00:00:00.000Z" };
}

describe("diagnoseBrokenLinks", () => {
  it("returns an empty list when there are no broken URLs", () => {
    expect(diagnoseBrokenLinks(site([page()]))).toEqual([]);
  });

  it("classifies a dead URL with no live page linking to it as sitemap-only (empty linkedFromPages)", () => {
    const result = diagnoseBrokenLinks(site([page({ internalLinks: [] })], ["https://example.com/dead"]));
    expect(result).toHaveLength(1);
    expect(result[0].linkedFromPages).toEqual([]);
  });

  it("finds the live page(s) that actually link to a dead URL", () => {
    const linker = page({ url: "https://example.com/blog", internalLinks: ["https://example.com/dead"] });
    const result = diagnoseBrokenLinks(site([linker], ["https://example.com/dead"]));
    expect(result[0].linkedFromPages).toEqual(["https://example.com/blog"]);
  });

  it("lists every live page that links to the same dead URL", () => {
    const a = page({ url: "https://example.com/a", internalLinks: ["https://example.com/dead"] });
    const b = page({ url: "https://example.com/b", internalLinks: ["https://example.com/dead"] });
    const result = diagnoseBrokenLinks(site([a, b], ["https://example.com/dead"]));
    expect(result[0].linkedFromPages.sort()).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("matches links and dead URLs regardless of a trailing slash or hash fragment", () => {
    const linker = page({ url: "https://example.com/blog", internalLinks: ["https://example.com/dead/#section"] });
    const result = diagnoseBrokenLinks(site([linker], ["https://example.com/dead"]));
    expect(result[0].linkedFromPages).toEqual(["https://example.com/blog"]);
  });

  it("suggests a live page whose title overlaps the dead URL's slug", () => {
    const replacement = page({ url: "https://example.com/humira-biosimilars-guide", title: "Humira Biosimilars: The Full Guide" });
    const result = diagnoseBrokenLinks(site([replacement], ["https://example.com/blog/humira-biosimilars-comparison"]));
    expect(result[0].suggestedReplacement).toBe("https://example.com/humira-biosimilars-guide");
  });

  it("returns null when no live page is a confident match", () => {
    const unrelated = page({ url: "https://example.com/contact-us", title: "Contact Us" });
    const result = diagnoseBrokenLinks(site([unrelated], ["https://example.com/blog/humira-biosimilars-comparison"]));
    expect(result[0].suggestedReplacement).toBeNull();
  });

  it("returns null when live pages have no title to compare against", () => {
    const untitled = page({ url: "https://example.com/x", title: null });
    const result = diagnoseBrokenLinks(site([untitled], ["https://example.com/blog/humira-guide"]));
    expect(result[0].suggestedReplacement).toBeNull();
  });

  it("diagnoses every failed URL independently", () => {
    const result = diagnoseBrokenLinks(site([page()], ["https://example.com/dead-1", "https://example.com/dead-2"]));
    expect(result.map((d) => d.url).sort()).toEqual(["https://example.com/dead-1", "https://example.com/dead-2"]);
  });
});
