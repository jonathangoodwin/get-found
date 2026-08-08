import { ClaudeKeywordExpander, RuleBasedKeywordExpander, type KeywordExpander } from "./ai/keyword-expansion.js";
import { fetchInterestOverTime, warmTrendsSession } from "./collectors/trends-interest.js";
import { computeInterestDelta } from "./gap-engine/keyword-trends.js";
import type { KeywordTrendSignal } from "./types.js";

export interface TrendWatchOptions {
  /** Seed keyword themes the user configured — expanded before checking. */
  themes: string[];
  geo?: string;
  timeframeDays?: number;
  /** Minimum % rise (recent window vs baseline) to count as a signal. */
  deltaThresholdPercent?: number;
  useAi?: boolean;
  businessContext?: string;
  /** Delay between per-keyword Trends lookups, in ms — politeness / rate-limit avoidance. */
  requestDelayMs?: number;
  onProgress?: (message: string) => void;
}

export interface TrendWatchResult {
  /** The full expanded keyword set that was actually checked against Google Trends. */
  checkedKeywords: string[];
  /** Keywords whose recent interest cleared the threshold, highest delta first. */
  signals: KeywordTrendSignal[];
}

const DEFAULT_THRESHOLD_PERCENT = 50;
const DEFAULT_REQUEST_DELAY_MS = 1000;

/**
 * Expands user-supplied keyword themes (AI if available, a modifier-based
 * fallback otherwise), then checks each expanded keyword's real Google
 * Trends interest-over-time series for a recent spike. This is the
 * keyword-specific counterpart to the free `--trends` general-trending-now
 * matcher: slower, hits a fragile undocumented endpoint per keyword, and
 * meant to run on a schedule the user controls rather than on every report.
 */
export async function runTrendWatch(opts: TrendWatchOptions): Promise<TrendWatchResult> {
  const log = opts.onProgress ?? (() => {});
  const threshold = opts.deltaThresholdPercent ?? DEFAULT_THRESHOLD_PERCENT;
  const geo = opts.geo ?? "US";

  const expander = buildExpander(opts.useAi ?? true);
  log(`Expanding ${opts.themes.length} keyword theme(s)...`);
  const checkedKeywords = await expandKeywords(expander, opts.themes, opts.businessContext, log);

  log(`Checking ${checkedKeywords.length} keyword(s) against Google Trends (${geo})...`);
  const cookie = await warmTrendsSession(geo);

  const signals: KeywordTrendSignal[] = [];
  for (const [index, keyword] of checkedKeywords.entries()) {
    if (index > 0 && opts.requestDelayMs !== 0) {
      await sleep(opts.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS);
    }

    const points = await fetchInterestOverTime(keyword, cookie, { geo, timeframeDays: opts.timeframeDays });
    const delta = computeInterestDelta(points);
    if (delta && delta.deltaPercent >= threshold) {
      signals.push({
        keyword,
        baselineInterest: delta.baseline,
        recentInterest: delta.recent,
        deltaPercent: delta.deltaPercent,
        points,
      });
    }
  }

  signals.sort((a, b) => b.deltaPercent - a.deltaPercent);
  return { checkedKeywords, signals };
}

interface ExpanderHandle {
  primary: KeywordExpander;
  ruleBased: RuleBasedKeywordExpander;
  canUseAi: boolean;
}

function buildExpander(useAi: boolean): ExpanderHandle {
  const ruleBased = new RuleBasedKeywordExpander();
  const canUseAi = useAi && Boolean(process.env.ANTHROPIC_API_KEY);
  const primary: KeywordExpander = canUseAi ? new ClaudeKeywordExpander() : ruleBased;
  return { primary, ruleBased, canUseAi };
}

async function expandKeywords(
  expander: ExpanderHandle,
  themes: string[],
  businessContext: string | undefined,
  log: (message: string) => void
): Promise<string[]> {
  try {
    return await expander.primary.expandKeywords(themes, { businessContext });
  } catch (err) {
    if (expander.canUseAi) {
      log(`Claude keyword expansion failed, falling back to rule-based: ${(err as Error).message}`);
      return expander.ruleBased.expandKeywords(themes, { businessContext });
    }
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
