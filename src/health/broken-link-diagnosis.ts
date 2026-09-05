import { canonicalizeTopic } from "../gap-engine/topics.js";
import type { BrokenLinkDiagnosis, PageRecord, SiteCrawlResult } from "../types.js";

const MIN_SUGGESTION_SCORE = 0.34;

/**
 * Classifies each broken URL by real-world exposure and suggests a live
 * replacement. Every failedUrl is sitemap-sourced by construction (the
 * crawler only ever attempts sitemap URLs) — what matters for urgency is
 * whether a real visitor could also reach it by clicking through the site:
 * a dead URL with no live page linking to it is a stale sitemap entry
 * (regenerate/prune the sitemap); one that IS linked from a live page is an
 * actual broken link a visitor can hit.
 */
export function diagnoseBrokenLinks(site: SiteCrawlResult): BrokenLinkDiagnosis[] {
  const linkedFrom = buildInboundLinkIndex(site.pages);

  return site.failedUrls.map((url) => ({
    url,
    linkedFromPages: linkedFrom.get(normalizeUrl(url)) ?? [],
    suggestedReplacement: suggestReplacement(url, site.pages),
  }));
}

function buildInboundLinkIndex(pages: PageRecord[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const page of pages) {
    for (const link of page.internalLinks) {
      const key = normalizeUrl(link);
      if (!index.has(key)) index.set(key, []);
      index.get(key)!.push(page.url);
    }
  }
  return index;
}

/**
 * Best-guess live replacement, scored by word overlap (Jaccard) between the
 * dead URL's slug and each live page's title — reuses the same
 * stopword/stemming normalization as content-gap topic matching so
 * "humira-generic-list" and "Generic Humira: The Full List" can match.
 */
function suggestReplacement(deadUrl: string, livePages: PageRecord[]): string | null {
  const deadWords = wordSet(slugToText(deadUrl));
  if (deadWords.size === 0) return null;

  let best: { url: string; score: number } | null = null;
  for (const page of livePages) {
    if (!page.title) continue;
    const liveWords = wordSet(page.title);
    const score = jaccard(deadWords, liveWords);
    if (score >= MIN_SUGGESTION_SCORE && (!best || score > best.score)) {
      best = { url: page.url, score };
    }
  }
  return best?.url ?? null;
}

function slugToText(url: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.split("/").filter(Boolean).pop() ?? "";
    return slug.replace(/[-_]+/g, " ").replace(/\.(html?|php)$/i, "");
  } catch {
    return "";
  }
}

function wordSet(text: string): Set<string> {
  return new Set(canonicalizeTopic(text).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
