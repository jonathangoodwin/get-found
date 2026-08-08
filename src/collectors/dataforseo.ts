import type { BacklinkDomain, KeywordMetrics } from "../types.js";

const SEARCH_VOLUME_URL = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
/** DataForSEO's Google Ads Live endpoints accept at most 1000 keywords per task. */
const MAX_KEYWORDS_PER_REQUEST = 1000;

const DOMAIN_INTERSECTION_URL = "https://api.dataforseo.com/v3/backlinks/domain_intersection/live";
/** DataForSEO's domain_intersection endpoint accepts at most 20 domains in `targets`. */
const MAX_INTERSECTION_TARGETS = 20;

export interface DataForSeoCredentials {
  login: string;
  password: string;
}

export function loadDataForSeoCredentialsFromEnv(): DataForSeoCredentials | null {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) return null;
  return { login, password };
}

export interface KeywordDataProvider {
  getSearchVolume(keywords: string[]): Promise<KeywordMetrics[]>;
}

export interface DataForSeoOptions {
  locationName?: string;
  languageCode?: string;
}

/**
 * Pay-as-you-go keyword volume via DataForSEO's Google Ads Live endpoint
 * (~$0.002/keyword at time of writing). Optional — the gap-engine works
 * without this; it only sharpens scoring with real search volume instead of
 * the competitor-coverage-count heuristic.
 */
export class DataForSeoProvider implements KeywordDataProvider {
  constructor(
    private readonly credentials: DataForSeoCredentials,
    private readonly options: DataForSeoOptions = {}
  ) {}

  async getSearchVolume(keywords: string[]): Promise<KeywordMetrics[]> {
    const results: KeywordMetrics[] = [];
    for (const batch of chunk(keywords, MAX_KEYWORDS_PER_REQUEST)) {
      results.push(...(await this.fetchBatch(batch)));
    }
    return results;
  }

  private async fetchBatch(keywords: string[]): Promise<KeywordMetrics[]> {
    const auth = Buffer.from(`${this.credentials.login}:${this.credentials.password}`).toString("base64");
    const res = await fetch(SEARCH_VOLUME_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        {
          keywords,
          location_name: this.options.locationName ?? "United States",
          language_code: this.options.languageCode ?? "en",
        },
      ]),
    });

    if (!res.ok) {
      throw new Error(`DataForSEO request failed: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as DataForSeoResponse;
    const items = json.tasks?.[0]?.result ?? [];
    return items
      .filter((item) => typeof item.keyword === "string")
      .map((item) => ({
        keyword: item.keyword,
        searchVolume: item.search_volume ?? null,
        competitionIndex: item.competition_index ?? null,
        cpc: item.cpc ?? null,
      }));
  }
}

interface DataForSeoResponse {
  tasks?: Array<{
    result?: Array<{
      keyword: string;
      search_volume?: number | null;
      competition_index?: number | null;
      cpc?: number | null;
    }>;
  }>;
}

export interface LinkGapOptions {
  /** How many referring domains to retrieve, 1-1000 (DataForSEO default 100). */
  limit?: number;
}

/**
 * Domains that link to at least one competitor but not to the own site —
 * DataForSEO's Domain Intersection endpoint, the same data Ahrefs/Moz-style
 * "link gap" tools are built on. `ownDomain` goes in as target "1"; any
 * result that already links to target "1" is filtered out client-side
 * rather than trusted to the API's own intersection semantics, since we
 * want "links to any competitor, not us" specifically, not "links to all
 * targets."
 */
export async function fetchLinkGapDomains(
  ownDomain: string,
  competitorDomains: string[],
  credentials: DataForSeoCredentials,
  opts: LinkGapOptions = {}
): Promise<BacklinkDomain[]> {
  const competitors = competitorDomains.slice(0, MAX_INTERSECTION_TARGETS - 1);
  const targets: Record<string, string> = { "1": ownDomain };
  competitors.forEach((domain, i) => {
    targets[String(i + 2)] = domain;
  });

  const auth = Buffer.from(`${credentials.login}:${credentials.password}`).toString("base64");
  const res = await fetch(DOMAIN_INTERSECTION_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify([{ targets, limit: opts.limit ?? 100 }]),
  });

  if (!res.ok) {
    throw new Error(`DataForSEO request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as DomainIntersectionResponse;
  const items = json.tasks?.[0]?.result?.[0]?.items ?? [];

  const results: BacklinkDomain[] = [];
  for (const item of items) {
    const intersection = item.domain_intersection ?? {};
    if (intersection["1"]) continue; // already links to us — not a gap

    let referringDomain = "";
    let rank = 0;
    const competitorsLinking: string[] = [];

    for (const [key, entry] of Object.entries(intersection)) {
      if (!entry) continue;
      referringDomain = entry.target ?? referringDomain;
      rank = Math.max(rank, entry.rank ?? 0);
      const competitorIndex = Number(key) - 2;
      if (competitorIndex >= 0 && competitors[competitorIndex]) {
        competitorsLinking.push(competitors[competitorIndex]);
      }
    }

    if (referringDomain && competitorsLinking.length > 0) {
      results.push({ domain: referringDomain, rank, competitorsLinking });
    }
  }

  return results;
}

interface DomainIntersectionResponse {
  tasks?: Array<{
    result?: Array<{
      items?: Array<{
        domain_intersection?: Record<string, { target?: string; rank?: number } | null>;
      }>;
    }>;
  }>;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
