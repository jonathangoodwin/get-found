import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInterestOverTime, warmTrendsSession } from "../../src/collectors/trends-interest.js";

const EXPLORE_RESPONSE = `)]}'\n{"widgets":[{"id":"TIMESERIES","token":"abc123","request":{"time":"2026-05-01 2026-08-01","comparisonItem":[{"geo":"US"}]}},{"id":"OTHER_WIDGET","token":"xyz","request":{}}]}`;

const WIDGETDATA_RESPONSE = `)]}'\n{"default":{"timelineData":[{"time":"1746057600","value":[42]},{"time":"1746662400","value":[85]}]}}`;

function jsonResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("warmTrendsSession", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("extracts the NID cookie from the warm-up response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("ok", { status: 200, headers: { "set-cookie": "NID=533=abc123; Path=/; Domain=.google.com" } })
    );
    const cookie = await warmTrendsSession("US");
    expect(cookie).toBe("NID=533=abc123");
  });

  it("returns an empty string when no NID cookie is present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    expect(await warmTrendsSession("US")).toBe("");
  });

  it("requests the explore page for the given geo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("ok", { status: 200 }));
    await warmTrendsSession("GB");
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("geo=GB");
  });
});

describe("fetchInterestOverTime", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses the timeline into InterestPoint[] on a successful two-hop request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(EXPLORE_RESPONSE)).mockResolvedValueOnce(jsonResponse(WIDGETDATA_RESPONSE));

    const points = await fetchInterestOverTime("memory care pricing", "NID=abc", { geo: "US", timeframeDays: 90 });

    expect(points).toEqual([
      { date: "2025-05-01", value: 42 },
      { date: "2025-05-08", value: 85 },
    ]);
  });

  it("sends the cookie on both the explore and widgetdata requests", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(EXPLORE_RESPONSE)).mockResolvedValueOnce(jsonResponse(WIDGETDATA_RESPONSE));

    await fetchInterestOverTime("memory care pricing", "NID=abc", { geo: "US" });

    const [, exploreInit] = vi.mocked(fetch).mock.calls[0];
    const [, widgetInit] = vi.mocked(fetch).mock.calls[1];
    expect((exploreInit as RequestInit & { headers: Record<string, string> }).headers.Cookie).toBe("NID=abc");
    expect((widgetInit as RequestInit & { headers: Record<string, string> }).headers.Cookie).toBe("NID=abc");
  });

  it("encodes the keyword into the explore request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(EXPLORE_RESPONSE)).mockResolvedValueOnce(jsonResponse(WIDGETDATA_RESPONSE));

    await fetchInterestOverTime("memory care pricing", "", { geo: "US" });

    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(decodeURIComponent(String(url))).toContain("memory care pricing");
  });

  it("returns an empty list when no TIMESERIES widget is present", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(`)]}'\n{"widgets":[{"id":"OTHER","token":"x","request":{}}]}`));
    expect(await fetchInterestOverTime("keyword", "")).toEqual([]);
  });

  it("returns an empty list when the explore request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse("blocked", 429));
    expect(await fetchInterestOverTime("keyword", "")).toEqual([]);
  });

  it("returns an empty list when the widgetdata request fails", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(EXPLORE_RESPONSE)).mockResolvedValueOnce(jsonResponse("blocked", 429));
    expect(await fetchInterestOverTime("keyword", "")).toEqual([]);
  });

  it("returns an empty list instead of throwing on malformed JSON", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse(`)]}'\nnot json`));
    expect(await fetchInterestOverTime("keyword", "")).toEqual([]);
  });
});
