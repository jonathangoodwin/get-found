import * as cheerio from "cheerio";
import type { PageRecord, SiteCrawlResult } from "../types.js";
import { politeFetch } from "./http.js";
import { fetchRobotsRules, type RobotsRules } from "./robots.js";
import { discoverSitemapUrls } from "./sitemap.js";

export interface CrawlOptions {
  maxPages?: number;
  /** Minimum delay between page fetches, in ms — be a polite crawler. Raised
   *  automatically if the site's robots.txt declares a longer Crawl-delay. */
  delayMs?: number;
}

/** Crawls a domain's sitemap and extracts structural SEO fields per page. */
export async function crawlSite(domain: string, opts: CrawlOptions = {}): Promise<SiteCrawlResult> {
  const maxPages = opts.maxPages ?? 200;
  const requestedDelayMs = opts.delayMs ?? 250;

  const [urls, robots] = await Promise.all([
    discoverSitemapUrls(domain, { maxUrls: maxPages }),
    fetchRobotsRules(domain),
  ]);

  const delayMs = resolveCrawlDelayMs(requestedDelayMs, robots);

  const pages: PageRecord[] = [];
  const failedUrls: string[] = [];
  for (const url of urls) {
    const page = await fetchPageRecord(url, domain);
    if (page) pages.push(page);
    else failedUrls.push(url);
    if (delayMs > 0) await sleep(delayMs);
  }

  return { domain, pages, failedUrls, crawledAt: new Date().toISOString() };
}

/** robots.txt Crawl-delay is a floor: only slows the crawl down when it exceeds the requested delay, never speeds it up. */
export function resolveCrawlDelayMs(requestedDelayMs: number, robots: RobotsRules): number {
  return robots.crawlDelaySeconds != null
    ? Math.max(requestedDelayMs, robots.crawlDelaySeconds * 1000)
    : requestedDelayMs;
}

export async function fetchPageRecord(url: string, domain: string): Promise<PageRecord | null> {
  let html: string;
  try {
    const res = await politeFetch(url);
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;
    html = await res.text();
  } catch {
    return null;
  }

  return parsePageHtml(url, domain, html);
}

export function parsePageHtml(url: string, domain: string, html: string): PageRecord {
  const $ = cheerio.load(html);

  const title = $("title").first().text().trim() || null;
  const metaDescription = $('meta[name="description"]').attr("content")?.trim() || null;
  const canonicalUrl = $('link[rel="canonical"]').attr("href")?.trim() || null;
  const hasSchema = $('script[type="application/ld+json"]').length > 0;
  const robotsMeta = $('meta[name="robots"]').attr("content")?.toLowerCase() ?? "";
  const isNoindex = robotsMeta.split(",").map((v) => v.trim()).includes("noindex");

  const h1 = collectHeadings($, "h1");
  const h2 = collectHeadings($, "h2");
  const h3 = collectHeadings($, "h3");

  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText ? bodyText.split(" ").length : 0;

  return {
    url,
    domain,
    title,
    metaDescription,
    h1,
    h2,
    h3,
    wordCount,
    canonicalUrl,
    hasSchema,
    isNoindex,
    fetchedAt: new Date().toISOString(),
  };
}

function collectHeadings($: cheerio.CheerioAPI, selector: string): string[] {
  return $(selector)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
