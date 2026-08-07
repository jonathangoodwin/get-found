import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchCoreWebVitals, fetchCoreWebVitalsForUrls, loadCruxCredentialsFromEnv } from "../../src/collectors/crux.js";

const credentials = { apiKey: "test-key" };

describe("fetchCoreWebVitals", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a successful response into CoreWebVitals p75 values", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          record: {
            metrics: {
              largest_contentful_paint: { percentiles: { p75: 2100 } },
              interaction_to_next_paint: { percentiles: { p75: 180 } },
              cumulative_layout_shift: { percentiles: { p75: 0.05 } },
            },
          },
        }),
        { status: 200 }
      )
    );

    const result = await fetchCoreWebVitals("https://example.com/", credentials);

    expect(result).toEqual({ url: "https://example.com/", lcpMs: 2100, inpMs: 180, cls: 0.05 });
  });

  it("sends the API key and URL in the request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ record: {} }), { status: 200 }));

    await fetchCoreWebVitals("https://example.com/page", credentials);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("key=test-key");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ url: "https://example.com/page" });
  });

  it("returns null when Chrome has no real-user data for the URL (404)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await fetchCoreWebVitals("https://example.com/low-traffic", credentials)).toBeNull();
  });

  it("defaults missing metrics to null rather than throwing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ record: { metrics: {} } }), { status: 200 }));
    const result = await fetchCoreWebVitals("https://example.com/", credentials);
    expect(result).toEqual({ url: "https://example.com/", lcpMs: null, inpMs: null, cls: null });
  });

  it("throws on a non-2xx, non-404 response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("server error", { status: 500, statusText: "Internal Server Error" }));
    await expect(fetchCoreWebVitals("https://example.com/", credentials)).rejects.toThrow(/500/);
  });
});

describe("fetchCoreWebVitalsForUrls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("drops URLs with no data and keeps the rest", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ record: { metrics: {} } }), { status: 200 }))
      .mockResolvedValueOnce(new Response("not found", { status: 404 }));

    const results = await fetchCoreWebVitalsForUrls(["https://example.com/a", "https://example.com/b"], credentials);

    expect(results).toHaveLength(1);
    expect(results[0].url).toBe("https://example.com/a");
  });
});

describe("loadCruxCredentialsFromEnv", () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when CRUX_API_KEY is unset", () => {
    delete process.env.CRUX_API_KEY;
    expect(loadCruxCredentialsFromEnv()).toBeNull();
  });

  it("returns credentials when CRUX_API_KEY is set", () => {
    process.env.CRUX_API_KEY = "abc123";
    expect(loadCruxCredentialsFromEnv()).toEqual({ apiKey: "abc123" });
  });
});
