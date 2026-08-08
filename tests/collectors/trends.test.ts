import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTrendingSearches, parseTrendingRss } from "../../src/collectors/trends.js";

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:atom="http://www.w3.org/2005/Atom" xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
<channel>
<title>Google Trends</title>
<item>
<title>psg vs man united</title>
<ht:approx_traffic>2000+</ht:approx_traffic>
<description/>
<link>https://trends.google.com/trending/rss?geo=US</link>
<pubDate>Sat, 8 Aug 2026 07:10:00 -0700</pubDate>
<ht:news_item>
<ht:news_item_title>Confirmed: United squad for PSG</ht:news_item_title>
<ht:news_item_snippet/>
<ht:news_item_url>https://www.manutd.com/en/news/confirmed-united-squad-for-psg</ht:news_item_url>
<ht:news_item_source>Manchester United Website</ht:news_item_source>
</ht:news_item>
</item>
<item>
<title>jim ross</title>
<ht:approx_traffic>500+</ht:approx_traffic>
<description/>
<link>https://trends.google.com/trending/rss?geo=US</link>
<pubDate>Sat, 8 Aug 2026 07:10:00 -0700</pubDate>
<ht:news_item>
<ht:news_item_title>WWE Hall of Famer headed for serious surgery</ht:news_item_title>
<ht:news_item_snippet/>
<ht:news_item_url>https://www.pennlive.com/entertainment/2026/08/jim-ross.html</ht:news_item_url>
<ht:news_item_source>PennLive.com</ht:news_item_source>
</ht:news_item>
</item>
</channel>
</rss>`;

describe("parseTrendingRss", () => {
  it("parses query, approx traffic, and news items from a real feed sample", () => {
    const searches = parseTrendingRss(SAMPLE_RSS);
    expect(searches).toHaveLength(2);
    expect(searches[0]).toEqual({
      query: "psg vs man united",
      approxTraffic: "2000+",
      newsItems: [
        {
          title: "Confirmed: United squad for PSG",
          url: "https://www.manutd.com/en/news/confirmed-united-squad-for-psg",
          source: "Manchester United Website",
        },
      ],
    });
    expect(searches[1].query).toBe("jim ross");
  });

  it("handles a single news_item (not wrapped in an array)", () => {
    const xml = `<rss><channel><item><title>solo trend</title><ht:approx_traffic>100+</ht:approx_traffic>
      <ht:news_item><ht:news_item_title>Only story</ht:news_item_title><ht:news_item_url>https://example.com/a</ht:news_item_url></ht:news_item>
      </item></channel></rss>`;
    const searches = parseTrendingRss(xml);
    expect(searches).toHaveLength(1);
    expect(searches[0].newsItems).toEqual([{ title: "Only story", url: "https://example.com/a", source: null }]);
  });

  it("skips items with no title", () => {
    const xml = `<rss><channel><item><ht:approx_traffic>100+</ht:approx_traffic></item></channel></rss>`;
    expect(parseTrendingRss(xml)).toEqual([]);
  });

  it("returns an empty list for a feed with no items", () => {
    expect(parseTrendingRss(`<rss><channel><title>Google Trends</title></channel></rss>`)).toEqual([]);
  });

  it("returns an empty list for malformed XML instead of throwing", () => {
    expect(parseTrendingRss("<not><valid")).toEqual([]);
  });
});

describe("fetchTrendingSearches", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the trending RSS feed for the given geo", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(SAMPLE_RSS, { status: 200 }));
    await fetchTrendingSearches("GB");
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://trends.google.com/trending/rss?geo=GB");
  });

  it("defaults to US when no geo is given", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(SAMPLE_RSS, { status: 200 }));
    await fetchTrendingSearches();
    const [url] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toContain("geo=US");
  });

  it("returns the parsed searches on success", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(SAMPLE_RSS, { status: 200 }));
    const searches = await fetchTrendingSearches("US");
    expect(searches).toHaveLength(2);
  });

  it("returns an empty list when the feed is unreachable", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("nope", { status: 500 }));
    expect(await fetchTrendingSearches("US")).toEqual([]);
  });
});
