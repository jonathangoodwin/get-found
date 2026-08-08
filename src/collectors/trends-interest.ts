import { politeFetch } from "./http.js";
import type { InterestPoint } from "../types.js";

const BASE_URL = "https://trends.google.com/trends";
const XSSI_PREFIX = ")]}'";

interface ExploreWidget {
  id: string;
  token: string;
  request: unknown;
}

/**
 * Reverse-engineered Google Trends "interest over time" endpoint — the same
 * one `pytrends` scrapes, and the one whose session bootstrap broke in 2026
 * (see README: Google changed how the NID cookie needs to be acquired
 * before the token exchange works, and any real workload now needs proxy
 * rotation to avoid 429s). This mirrors pytrends' known-good request shapes.
 * One session cookie is meant to be warmed once per batch (warmTrendsSession)
 * and reused across keywords — re-warming per keyword multiplies the
 * request count for no benefit and raises rate-limit risk.
 */
export async function warmTrendsSession(geo = "US"): Promise<string> {
  const res = await politeFetch(`${BASE_URL}/explore?geo=${encodeURIComponent(geo)}`, {
    headers: { "Accept-Language": "en-US" },
  });
  const cookies = res.headers.getSetCookie?.() ?? [];
  const nid = cookies.find((c) => c.startsWith("NID="));
  return nid ? nid.split(";")[0] : "";
}

/**
 * Fetches one keyword's interest-over-time series. Returns an empty list on
 * any failure (rate limit, missing token, malformed response) rather than
 * throwing, so one bad keyword doesn't take down a whole trend-watch batch.
 */
export async function fetchInterestOverTime(
  keyword: string,
  cookie: string,
  opts: { geo?: string; timeframeDays?: number } = {}
): Promise<InterestPoint[]> {
  const geo = opts.geo ?? "US";
  const timeframe = toGoogleTimeframe(opts.timeframeDays ?? 90);

  try {
    const widget = await fetchTimeseriesWidget(keyword, geo, timeframe, cookie);
    if (!widget) return [];
    return await fetchWidgetTimeline(widget, cookie);
  } catch {
    return [];
  }
}

async function fetchTimeseriesWidget(
  keyword: string,
  geo: string,
  timeframe: string,
  cookie: string
): Promise<ExploreWidget | null> {
  const req = { comparisonItem: [{ keyword, time: timeframe, geo }], category: 0, property: "" };
  const url = `${BASE_URL}/api/explore?hl=en-US&tz=360&req=${encodeURIComponent(JSON.stringify(req))}`;
  const res = await politeFetch(url, { headers: requestHeaders(cookie) });
  if (!res.ok) return null;

  const parsed = JSON.parse(stripXssiPrefix(await res.text())) as { widgets?: ExploreWidget[] };
  return parsed.widgets?.find((w) => w.id === "TIMESERIES") ?? null;
}

async function fetchWidgetTimeline(widget: ExploreWidget, cookie: string): Promise<InterestPoint[]> {
  const url = `${BASE_URL}/api/widgetdata/multiline?tz=360&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
  const res = await politeFetch(url, { headers: requestHeaders(cookie) });
  if (!res.ok) return [];

  const parsed = JSON.parse(stripXssiPrefix(await res.text())) as {
    default?: { timelineData?: Array<{ time: string; value: number[] }> };
  };
  const timeline = parsed.default?.timelineData ?? [];
  return timeline
    .filter((point) => Array.isArray(point.value) && point.value.length > 0 && point.time)
    .map((point) => ({
      date: new Date(Number(point.time) * 1000).toISOString().slice(0, 10),
      value: point.value[0],
    }));
}

function requestHeaders(cookie: string): Record<string, string> {
  const headers: Record<string, string> = { "Accept-Language": "en-US" };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

function stripXssiPrefix(text: string): string {
  return text.startsWith(XSSI_PREFIX) ? text.slice(XSSI_PREFIX.length + 1) : text;
}

const TIMEFRAME_BUCKETS: Array<[number, string]> = [
  [7, "now 7-d"],
  [30, "today 1-m"],
  [90, "today 3-m"],
  [270, "today 12-m"],
];

function toGoogleTimeframe(days: number): string {
  for (const [maxDays, label] of TIMEFRAME_BUCKETS) {
    if (days <= maxDays) return label;
  }
  return "today 5-y";
}
