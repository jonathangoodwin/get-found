import type { InterestPoint } from "../types.js";

export interface InterestDelta {
  baseline: number;
  recent: number;
  deltaPercent: number;
}

const DEFAULT_RECENT_WINDOW = 7;

/**
 * Compares the average of the most recent `recentWindow` points against the
 * average of everything before them. Defaults to 7 (a week) since Google
 * returns daily-resolution points for lookback windows up to ~9 months —
 * comparing single days against a long baseline is too noisy. This is a
 * plain moving-average breakout check, not statistical anomaly detection —
 * deliberately simple and auditable, matching the deterministic-spine
 * pattern used everywhere else in the gap-engine. Returns null when there
 * isn't enough history to compare (need at least 2x recentWindow points).
 */
export function computeInterestDelta(points: InterestPoint[], opts: { recentWindow?: number } = {}): InterestDelta | null {
  const recentWindow = opts.recentWindow ?? DEFAULT_RECENT_WINDOW;
  if (points.length < recentWindow * 2) return null;

  const recentPoints = points.slice(-recentWindow);
  const baselinePoints = points.slice(0, -recentWindow);
  const recent = average(recentPoints.map((p) => p.value));
  const baseline = average(baselinePoints.map((p) => p.value));

  const deltaPercent = baseline === 0 ? recent * 100 : ((recent - baseline) / baseline) * 100;

  return { baseline, recent, deltaPercent };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
