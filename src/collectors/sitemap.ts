import { XMLParser } from "fast-xml-parser";
import { politeFetch } from "./http.js";
import { fetchRobotsRules, isAllowedByRobots } from "./robots.js";

const parser = new XMLParser({ ignoreAttributes: false });

interface SitemapUrlEntry {
  loc: string;
}

/**
 * Resolves a domain's sitemap(s) to a flat list of page URLs, following
 * sitemap-index files one level deep and respecting robots.txt Disallow
 * rules. Falls back to /sitemap.xml if none is declared in robots.txt.
 */
export async function discoverSitemapUrls(
  domain: string,
  opts: { maxUrls?: number } = {}
): Promise<string[]> {
  const maxUrls = opts.maxUrls ?? 500;
  const robots = await fetchRobotsRules(domain);
  const sitemapUrls = await findSitemapLocations(domain, robots);

  const pageUrls: string[] = [];
  for (const sitemapUrl of sitemapUrls) {
    if (pageUrls.length >= maxUrls) break;
    const entries = await fetchSitemap(sitemapUrl, maxUrls - pageUrls.length);
    for (const entry of entries) {
      const path = safePath(entry.loc);
      if (path && isAllowedByRobots(path, robots)) {
        pageUrls.push(entry.loc);
      }
      if (pageUrls.length >= maxUrls) break;
    }
  }
  return dedupe(pageUrls);
}

async function findSitemapLocations(domain: string, robots: { disallow: string[] }): Promise<string[]> {
  const robotsUrl = `https://${domain}/robots.txt`;
  try {
    const res = await politeFetch(robotsUrl);
    if (res.ok) {
      const text = await res.text();
      const declared = [...text.matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]);
      if (declared.length > 0) return declared;
    }
  } catch {
    // fall through to default guess
  }
  return [`https://${domain}/sitemap.xml`];
}

async function fetchSitemap(sitemapUrl: string, limit: number): Promise<SitemapUrlEntry[]> {
  let xml: string;
  try {
    const res = await politeFetch(sitemapUrl);
    if (!res.ok) return [];
    xml = await res.text();
  } catch {
    return [];
  }

  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  // Sitemap index: recurse one level into child sitemaps.
  if (parsed.sitemapindex?.sitemap) {
    const children = toArray(parsed.sitemapindex.sitemap);
    const results: SitemapUrlEntry[] = [];
    for (const child of children) {
      if (results.length >= limit) break;
      if (child.loc) {
        const nested = await fetchSitemap(child.loc, limit - results.length);
        results.push(...nested);
      }
    }
    return results;
  }

  if (parsed.urlset?.url) {
    const entries = toArray(parsed.urlset.url);
    return entries
      .filter((e: any) => typeof e.loc === "string")
      .slice(0, limit)
      .map((e: any) => ({ loc: e.loc }));
  }

  return [];
}

function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}

function safePath(url: string): string | null {
  try {
    return new URL(url).pathname;
  } catch {
    return null;
  }
}

function dedupe(urls: string[]): string[] {
  return Array.from(new Set(urls));
}
