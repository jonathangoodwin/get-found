import type { KeywordMetrics } from "../types.js";

const SEARCH_VOLUME_URL = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
/** DataForSEO's Google Ads Live endpoints accept at most 1000 keywords per task. */
const MAX_KEYWORDS_PER_REQUEST = 1000;

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

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
