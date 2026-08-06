import { beforeEach, describe, expect, it, vi } from "vitest";

const mockQuery = vi.fn();
const mockSetCredentials = vi.fn();

vi.mock("googleapis", () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockImplementation(() => ({ setCredentials: mockSetCredentials })),
    },
    searchconsole: vi.fn().mockImplementation(() => ({
      searchanalytics: { query: mockQuery },
    })),
  },
}));

const { fetchSearchAnalytics, loadGscCredentialsFromEnv } = await import("../../src/collectors/gsc.js");

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
