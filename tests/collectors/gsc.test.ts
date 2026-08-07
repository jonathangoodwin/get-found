import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockSitemapsList = vi.fn();
const mockSetCredentials = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: mockSetCredentials })),
    },
    searchconsole: vi.fn().mockImplementation(() => ({
      searchanalytics: { query: mockQuery },
      sitemaps: { list: mockSitemapsList },
    })),
  },
}));

const { fetchSearchAnalytics, fetchSitemapStatus, loadGscCredentialsFromEnv } = await import(
  "../../src/collectors/gsc.js"
);

const credentials = { clientId: "id", clientSecret: "secret", refreshToken: "refresh" };

describe("fetchSearchAnalytics", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockSetCredentials.mockReset();
  });

  it("maps GSC rows into GscQueryRow, filtering malformed rows and defaulting missing metrics to 0", async () => {
    mockQuery.mockResolvedValueOnce({
      data: {
        rows: [
          { keys: ["memory care cost", "/pricing"], clicks: 5, impressions: 100, ctr: 0.05, position: 14 },
          { keys: ["only-one-key"], clicks: 1, impressions: 1, ctr: 1, position: 1 }, // malformed: needs 2 keys
          { keys: ["no metrics", "/x"] }, // missing clicks/impressions/ctr/position
        ],
      },
    });

    const rows = await fetchSearchAnalytics("https://example.com/", credentials, {
      startDate: "2026-01-01",
      endDate: "2026-04-01",
    });

    expect(rows).toEqual([
      { query: "memory care cost", page: "/pricing", clicks: 5, impressions: 100, ctr: 0.05, position: 14 },
      { query: "no metrics", page: "/x", clicks: 0, impressions: 0, ctr: 0, position: 0 },
    ]);
    expect(mockSetCredentials).toHaveBeenCalledWith({ refresh_token: "refresh" });
  });

  it("passes siteUrl, dimensions, and date range through to the API call", async () => {
    mockQuery.mockResolvedValueOnce({ data: { rows: [] } });

    await fetchSearchAnalytics("sc-domain:example.com", credentials, {
      startDate: "2026-01-01",
      endDate: "2026-04-01",
      rowLimit: 10,
    });

    expect(mockQuery).toHaveBeenCalledWith({
      siteUrl: "sc-domain:example.com",
      requestBody: {
        startDate: "2026-01-01",
        endDate: "2026-04-01",
        dimensions: ["query", "page"],
        rowLimit: 10,
      },
    });
  });

  it("returns an empty list when the API returns no rows", async () => {
    mockQuery.mockResolvedValueOnce({ data: {} });
    expect(
      await fetchSearchAnalytics("https://example.com/", credentials, { startDate: "2026-01-01", endDate: "2026-04-01" })
    ).toEqual([]);
  });
});

describe("fetchSitemapStatus", () => {
  beforeEach(() => {
    mockSitemapsList.mockReset();
    mockSetCredentials.mockReset();
  });

  it("maps sitemap entries into SitemapStatus, defaulting missing fields", async () => {
    mockSitemapsList.mockResolvedValueOnce({
      data: {
        sitemap: [
          {
            path: "https://example.com/sitemap.xml",
            lastDownloaded: "2026-08-01T00:00:00.000Z",
            isPending: false,
            warnings: "2",
            errors: "0",
            contents: [{ type: "web", submitted: "120", indexed: "115" }],
          },
          { path: "https://example.com/sitemap-2.xml" },
        ],
      },
    });

    const statuses = await fetchSitemapStatus("https://example.com/", credentials);

    expect(statuses).toEqual([
      {
        path: "https://example.com/sitemap.xml",
        lastDownloaded: "2026-08-01T00:00:00.000Z",
        isPending: false,
        warnings: 2,
        errors: 0,
        contents: [{ type: "web", submitted: 120, indexed: 115 }],
      },
      {
        path: "https://example.com/sitemap-2.xml",
        lastDownloaded: null,
        isPending: false,
        warnings: 0,
        errors: 0,
        contents: [],
      },
    ]);
  });

  it("returns an empty list when the property has no sitemaps", async () => {
    mockSitemapsList.mockResolvedValueOnce({ data: {} });
    expect(await fetchSitemapStatus("https://example.com/", credentials)).toEqual([]);
  });

  it("passes siteUrl through to the API call", async () => {
    mockSitemapsList.mockResolvedValueOnce({ data: {} });
    await fetchSitemapStatus("sc-domain:example.com", credentials);
    expect(mockSitemapsList).toHaveBeenCalledWith({ siteUrl: "sc-domain:example.com" });
  });
});

describe("loadGscCredentialsFromEnv", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null unless all three env vars are set", () => {
    delete process.env.GSC_CLIENT_ID;
    delete process.env.GSC_CLIENT_SECRET;
    delete process.env.GSC_REFRESH_TOKEN;
    expect(loadGscCredentialsFromEnv()).toBeNull();
  });

  it("returns credentials when all three are set", () => {
    process.env.GSC_CLIENT_ID = "id";
    process.env.GSC_CLIENT_SECRET = "secret";
    process.env.GSC_REFRESH_TOKEN = "refresh";
    expect(loadGscCredentialsFromEnv()).toEqual({ clientId: "id", clientSecret: "secret", refreshToken: "refresh" });
  });
});
