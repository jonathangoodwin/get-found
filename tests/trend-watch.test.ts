import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runTrendWatch } from "../src/trend-watch.js";

const EXPLORE_RESPONSE = `)]}'\n{"widgets":[{"id":"TIMESERIES","token":"tok","request":{"comparisonItem":[{"geo":"US"}]}}]}`;

function widgetDataResponse(values: number[]): string {
  const timelineData = values.map((v, i) => ({ time: String(1700000000 + i * 86400), value: [v] }));
  return `)]}'\n${JSON.stringify({ default: { timelineData } })}`;
}

const RISING_SERIES = widgetDataResponse([...Array(7).fill(10), ...Array(7).fill(50)]);

function mockRoutedFetch(widgetdataBody: string) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/api/explore")) return new Response(EXPLORE_RESPONSE, { status: 200 });
    if (url.includes("/api/widgetdata")) return new Response(widgetdataBody, { status: 200 });
    // session warm-up: GET /trends/explore?geo=...
    return new Response("ok", { status: 200, headers: { "set-cookie": "NID=533=fake; Path=/; Domain=.google.com" } });
  });
}

describe("runTrendWatch", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("expands seed themes and checks every expanded keyword", async () => {
    mockRoutedFetch(RISING_SERIES);

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.checkedKeywords).toContain("memory care");
    expect(result.checkedKeywords).toContain("memory care pricing");
    expect(result.checkedKeywords.length).toBeGreaterThan(1);
  });

  it("flags keywords whose recent interest clears the threshold", async () => {
    mockRoutedFetch(RISING_SERIES);

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 10,
    });

    expect(result.signals.length).toBe(result.checkedKeywords.length);
    for (const signal of result.signals) {
      expect(signal.deltaPercent).toBeGreaterThanOrEqual(10);
      expect(signal.recentInterest).toBeGreaterThan(signal.baselineInterest);
    }
  });

  it("returns no signals when nothing clears the threshold", async () => {
    mockRoutedFetch(RISING_SERIES);

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 100_000,
    });

    expect(result.signals).toEqual([]);
    expect(result.checkedKeywords.length).toBeGreaterThan(0);
  });

  it("sorts signals by delta, highest first", async () => {
    mockRoutedFetch(RISING_SERIES);

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    const deltas = result.signals.map((s) => s.deltaPercent);
    expect(deltas).toEqual([...deltas].sort((a, b) => b - a));
  });

  it("does not fail the whole batch when a keyword's Trends lookup errors", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/explore")) return new Response("blocked", { status: 429 });
      return new Response("ok", { status: 200, headers: { "set-cookie": "NID=533=fake" } });
    });

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.signals).toEqual([]);
    expect(result.checkedKeywords.length).toBeGreaterThan(0);
  });

  it("reports a healthy endpoint and zero failures when every lookup succeeds", async () => {
    mockRoutedFetch(RISING_SERIES);

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.endpointHealthy).toBe(true);
    expect(result.failedKeywordCount).toBe(0);
  });

  it("flags the endpoint unhealthy when the session cookie warm-up fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/explore")) return new Response(EXPLORE_RESPONSE, { status: 200 });
      if (url.includes("/api/widgetdata")) return new Response(RISING_SERIES, { status: 200 });
      return new Response("ok", { status: 200 }); // no set-cookie header — warm-up "fails"
    });

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.endpointHealthy).toBe(false);
  });

  it("flags the endpoint unhealthy when every single keyword lookup fails", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/explore")) return new Response("blocked", { status: 429 });
      return new Response("ok", { status: 200, headers: { "set-cookie": "NID=533=fake" } });
    });

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.endpointHealthy).toBe(false);
    expect(result.failedKeywordCount).toBe(result.checkedKeywords.length);
  });

  it("does not flag the endpoint unhealthy for an isolated single-keyword failure", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/explore")) {
        if (decodeURIComponent(url).includes("near me")) return new Response("blocked", { status: 429 });
        return new Response(EXPLORE_RESPONSE, { status: 200 });
      }
      if (url.includes("/api/widgetdata")) return new Response(RISING_SERIES, { status: 200 });
      return new Response("ok", { status: 200, headers: { "set-cookie": "NID=533=fake" } });
    });

    const result = await runTrendWatch({
      themes: ["memory care"],
      useAi: false,
      requestDelayMs: 0,
      deltaThresholdPercent: 1,
    });

    expect(result.failedKeywordCount).toBe(1);
    expect(result.endpointHealthy).toBe(true);
  });
});
