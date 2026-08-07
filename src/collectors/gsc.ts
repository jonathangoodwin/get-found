import { google, type searchconsole_v1 } from "googleapis";
import type { GscQueryRow, SitemapStatus } from "../types.js";

export interface GscCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export function loadGscCredentialsFromEnv(): GscCredentials | null {
  const clientId = process.env.GSC_CLIENT_ID;
  const clientSecret = process.env.GSC_CLIENT_SECRET;
  const refreshToken = process.env.GSC_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken };
}

function buildSearchConsoleClient(credentials: GscCredentials): searchconsole_v1.Searchconsole {
  const oauth2Client = new google.auth.OAuth2(credentials.clientId, credentials.clientSecret);
  oauth2Client.setCredentials({ refresh_token: credentials.refreshToken });
  return google.searchconsole({ version: "v1", auth: oauth2Client });
}

/**
 * Fetches query/page performance rows for a verified Search Console
 * property. `siteUrl` must match the property exactly, e.g.
 * "https://example.com/" or "sc-domain:example.com".
 */
export async function fetchSearchAnalytics(
  siteUrl: string,
  credentials: GscCredentials,
  opts: { startDate: string; endDate: string; rowLimit?: number } = {
    startDate: defaultStartDate(),
    endDate: defaultEndDate(),
  }
): Promise<GscQueryRow[]> {
  const searchconsole = buildSearchConsoleClient(credentials);

  const res = await searchconsole.searchanalytics.query({
    siteUrl,
    requestBody: {
      startDate: opts.startDate,
      endDate: opts.endDate,
      dimensions: ["query", "page"],
      rowLimit: opts.rowLimit ?? 5000,
    },
  });

  const rows = res.data.rows ?? [];
  return rows
    .filter((r) => r.keys && r.keys.length === 2)
    .map((r) => ({
      query: r.keys![0],
      page: r.keys![1],
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }));
}

/**
 * Submitted-vs-indexed counts and errors/warnings per sitemap, from the
 * Search Console Sitemaps API. This is the closest thing to genuine
 * "indexing issues" Google's API actually exposes — there is no public API
 * for the fuller Index Coverage report (soft 404s, crawl anomalies, etc.).
 */
export async function fetchSitemapStatus(siteUrl: string, credentials: GscCredentials): Promise<SitemapStatus[]> {
  const searchconsole = buildSearchConsoleClient(credentials);
  const res = await searchconsole.sitemaps.list({ siteUrl });
  const entries = res.data.sitemap ?? [];

  return entries.map((entry) => ({
    path: entry.path ?? "",
    lastDownloaded: entry.lastDownloaded ?? null,
    isPending: entry.isPending ?? false,
    warnings: Number(entry.warnings ?? 0),
    errors: Number(entry.errors ?? 0),
    contents: (entry.contents ?? []).map((c) => ({
      type: c.type ?? "unknown",
      submitted: Number(c.submitted ?? 0),
      indexed: Number(c.indexed ?? 0),
    })),
  }));
}

function defaultEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3); // GSC data has a 2-3 day delay
  return d.toISOString().slice(0, 10);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 3 - 90); // trailing ~90 days by default
  return d.toISOString().slice(0, 10);
}
