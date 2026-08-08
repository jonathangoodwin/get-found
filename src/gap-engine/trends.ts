import { canonicalizeTopic } from "./topics.js";
import type { TrendingSearch, TrendSignal } from "../types.js";

/**
 * Flags tracked topics that currently appear in Google's real-time trending
 * searches. Matching reuses canonicalizeTopic — the same fuzzy word-bag
 * comparison used for content-gap topics — rather than exact string
 * equality, since a trending search rarely matches a heading verbatim.
 */
export function matchTrendSignals(trending: TrendingSearch[], topics: string[]): TrendSignal[] {
  const canonicalTopics = new Map<string, string>();
  for (const topic of topics) {
    const key = canonicalizeTopic(topic);
    if (key) canonicalTopics.set(key, topic);
  }

  const signals: TrendSignal[] = [];
  for (const search of trending) {
    const key = canonicalizeTopic(search.query);
    const topic = canonicalTopics.get(key);
    if (!topic) continue;
    signals.push({
      topic,
      matchedQuery: search.query,
      approxTraffic: search.approxTraffic,
      newsItems: search.newsItems,
    });
  }

  return signals.sort((a, b) => parseApproxTraffic(b.approxTraffic) - parseApproxTraffic(a.approxTraffic));
}

function parseApproxTraffic(value: string | null): number {
  if (!value) return 0;
  const n = Number(value.replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
