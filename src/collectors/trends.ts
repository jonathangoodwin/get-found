import { XMLParser } from "fast-xml-parser";
import { politeFetch } from "./http.js";
import type { TrendNewsItem, TrendingSearch } from "../types.js";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });

const TRENDING_RSS_URL = "https://trends.google.com/trending/rss";

/**
 * Google's real-time "Trending now" feed — undocumented but stable and
 * token-free, unlike the keyword-specific interest-over-time endpoint (see
 * README: that one's session bootstrap broke in 2026 and needs proxy
 * rotation for any real workload, so it's deliberately not built here).
 * This returns general trending searches for a region; it's a signal when
 * one happens to match a topic you already care about, not a keyword-level
 * history.
 */
export async function fetchTrendingSearches(geo = "US"): Promise<TrendingSearch[]> {
  const res = await politeFetch(`${TRENDING_RSS_URL}?geo=${encodeURIComponent(geo)}`);
  if (!res.ok) return [];
  const xml = await res.text();
  return parseTrendingRss(xml);
}

export function parseTrendingRss(xml: string): TrendingSearch[] {
  let parsed: any;
  try {
    parsed = parser.parse(xml);
  } catch {
    return [];
  }

  const items = toArray(parsed?.rss?.channel?.item);
  return items
    .filter((item: any) => typeof item?.title === "string" && item.title.trim().length > 0)
    .map((item: any) => ({
      query: item.title.trim(),
      approxTraffic: typeof item.approx_traffic === "string" ? item.approx_traffic : null,
      newsItems: toArray(item.news_item).map(toNewsItem).filter((n: TrendNewsItem | null): n is TrendNewsItem => n !== null),
    }));
}

function toNewsItem(raw: any): TrendNewsItem | null {
  if (!raw || typeof raw.news_item_title !== "string" || typeof raw.news_item_url !== "string") return null;
  return {
    title: raw.news_item_title,
    url: raw.news_item_url,
    source: typeof raw.news_item_source === "string" ? raw.news_item_source : null,
  };
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
