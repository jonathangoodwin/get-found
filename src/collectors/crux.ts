import type { CoreWebVitals } from "../types.js";
import { politeFetch } from "./http.js";

const CRUX_URL = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

export interface CruxCredentials {
  apiKey: string;
}

export function loadCruxCredentialsFromEnv(): CruxCredentials | null {
  const apiKey = process.env.CRUX_API_KEY;
  return apiKey ? { apiKey } : null;
}

interface CruxResponse {
  record?: {
    metrics?: {
      largest_contentful_paint?: { percentiles?: { p75?: number } };
      interaction_to_next_paint?: { percentiles?: { p75?: number } };
      cumulative_layout_shift?: { percentiles?: { p75?: number } };
    };
  };
}

/**
 * Real-user Core Web Vitals for one URL, from the free Chrome UX Report API
 * — separate from (and not available via) the Search Console API. Returns
 * null when Chrome doesn't have enough real-user traffic on this URL to
 * report data, which is common for low-traffic pages and not an error.
 */
export async function fetchCoreWebVitals(url: string, credentials: CruxCredentials): Promise<CoreWebVitals | null> {
  const res = await politeFetch(`${CRUX_URL}?key=${encodeURIComponent(credentials.apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`CrUX request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as CruxResponse;
  const metrics = json.record?.metrics ?? {};

  return {
    url,
    lcpMs: metrics.largest_contentful_paint?.percentiles?.p75 ?? null,
    inpMs: metrics.interaction_to_next_paint?.percentiles?.p75 ?? null,
    cls: metrics.cumulative_layout_shift?.percentiles?.p75 ?? null,
  };
}

/**
 * Fetches Core Web Vitals for several URLs sequentially (CrUX has no batch
 * endpoint). URLs without enough real-user data are silently dropped rather
 * than surfaced as errors.
 */
export async function fetchCoreWebVitalsForUrls(urls: string[], credentials: CruxCredentials): Promise<CoreWebVitals[]> {
  const results: CoreWebVitals[] = [];
  for (const url of urls) {
    const result = await fetchCoreWebVitals(url, credentials);
    if (result) results.push(result);
  }
  return results;
}
