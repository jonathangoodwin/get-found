import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataForSeoProvider, loadDataForSeoCredentialsFromEnv } from "../../src/collectors/dataforseo.js";

const credentials = { login: "user", password: "pass" };

describe("DataForSeoProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends Basic auth and the documented request shape", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ tasks: [{ result: [] }] }), { status: 200 }));

    const provider = new DataForSeoProvider(credentials, { locationName: "United States", languageCode: "en" });
    await provider.getSearchVolume(["memory care cost"]);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as any).headers.Authorization).toBe(`Basic ${Buffer.from("user:pass").toString("base64")}`);

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body[0].keywords).toEqual(["memory care cost"]);
    expect(body[0].location_name).toBe("United States");
    expect(body[0].language_code).toBe("en");
  });

  it("maps a successful response into KeywordMetrics, defaulting missing fields to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tasks: [
            {
              result: [
                { keyword: "memory care cost", search_volume: 1200, competition_index: 40, cpc: 3.5 },
                { keyword: "assisted living cost" },
              ],
            },
          ],
        }),
        { status: 200 }
      )
    );

    const provider = new DataForSeoProvider(credentials);
    const results = await provider.getSearchVolume(["memory care cost", "assisted living cost"]);

    expect(results).toEqual([
      { keyword: "memory care cost", searchVolume: 1200, competitionIndex: 40, cpc: 3.5 },
      { keyword: "assisted living cost", searchVolume: null, competitionIndex: null, cpc: null },
    ]);
  });

  it("throws on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("unauthorized", { status: 401, statusText: "Unauthorized" }));
    const provider = new DataForSeoProvider(credentials);
    await expect(provider.getSearchVolume(["x"])).rejects.toThrow(/401/);
  });

  it("batches requests at 1000 keywords per call", async () => {
    vi.mocked(fetch).mockImplementation(
      async () => new Response(JSON.stringify({ tasks: [{ result: [] }] }), { status: 200 })
    );
    const provider = new DataForSeoProvider(credentials);
    const keywords = Array.from({ length: 1500 }, (_, i) => `kw${i}`);

    await provider.getSearchVolume(keywords);

    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    const firstBody = JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);
    const secondBody = JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string);
    expect(firstBody[0].keywords).toHaveLength(1000);
    expect(secondBody[0].keywords).toHaveLength(500);
  });
});

describe("loadDataForSeoCredentialsFromEnv", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns null unless both DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are set", () => {
    delete process.env.DATAFORSEO_LOGIN;
    delete process.env.DATAFORSEO_PASSWORD;
    expect(loadDataForSeoCredentialsFromEnv()).toBeNull();
  });

  it("returns credentials when both are set", () => {
    process.env.DATAFORSEO_LOGIN = "user";
    process.env.DATAFORSEO_PASSWORD = "pass";
    expect(loadDataForSeoCredentialsFromEnv()).toEqual({ login: "user", password: "pass" });
  });
});
