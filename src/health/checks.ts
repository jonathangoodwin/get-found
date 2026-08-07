import type { HealthFinding, SiteCrawlResult } from "../types.js";

const THIN_CONTENT_WORD_COUNT = 300;

export interface HealthCheckOptions {
  thinContentWordCount?: number;
}

/**
 * Structural site-health checks — everything checkable from data the crawl
 * already collects, no extra network calls. Deliberately does not attempt
 * to reproduce Search Console's Index Coverage report (soft 404s, crawl
 * anomalies): that report has no public API, and scraping the GSC UI for it
 * would be fragile and against the spirit of this integration.
 */
export function runHealthChecks(site: SiteCrawlResult, opts: HealthCheckOptions = {}): HealthFinding[] {
  const thinContentWordCount = opts.thinContentWordCount ?? THIN_CONTENT_WORD_COUNT;
  const findings: HealthFinding[] = [];

  for (const url of site.failedUrls) {
    findings.push({ type: "broken-link", url, detail: "Failed to fetch, or returned a non-2xx/non-HTML response." });
  }

  const titleToUrls = new Map<string, string[]>();
  const metaToUrls = new Map<string, string[]>();

  for (const page of site.pages) {
    if (!page.title) {
      findings.push({ type: "missing-title", url: page.url, detail: "No <title> tag found." });
    } else {
      addToGroup(titleToUrls, page.title, page.url);
    }

    if (!page.metaDescription) {
      findings.push({ type: "missing-meta-description", url: page.url, detail: "No meta description found." });
    } else {
      addToGroup(metaToUrls, page.metaDescription, page.url);
    }

    if (page.h1.length === 0) {
      findings.push({ type: "missing-h1", url: page.url, detail: "No H1 heading found." });
    } else if (page.h1.length > 1) {
      findings.push({
        type: "multiple-h1",
        url: page.url,
        detail: `${page.h1.length} H1 headings found; a page should have exactly one.`,
      });
    }

    if (page.wordCount < thinContentWordCount) {
      findings.push({
        type: "thin-content",
        url: page.url,
        detail: `Only ${page.wordCount} words (below the ${thinContentWordCount}-word floor).`,
      });
    }

    if (!page.hasSchema) {
      findings.push({ type: "missing-schema", url: page.url, detail: "No structured data (JSON-LD) found." });
    }

    if (page.isNoindex) {
      findings.push({ type: "noindex", url: page.url, detail: "Page has a noindex robots meta tag." });
    }
  }

  for (const [title, urls] of titleToUrls) {
    if (urls.length > 1) {
      findings.push({
        type: "duplicate-title",
        url: urls[0],
        detail: `Title "${title}" is duplicated across: ${urls.join(", ")}`,
      });
    }
  }
  for (const [meta, urls] of metaToUrls) {
    if (urls.length > 1) {
      findings.push({
        type: "duplicate-meta-description",
        url: urls[0],
        detail: `Meta description "${meta}" is duplicated across: ${urls.join(", ")}`,
      });
    }
  }

  return findings;
}

function addToGroup(map: Map<string, string[]>, key: string, url: string): void {
  if (!map.has(key)) map.set(key, []);
  map.get(key)!.push(url);
}
