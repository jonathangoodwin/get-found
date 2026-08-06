import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverSitemapUrls } from "../../src/collectors/sitemap.js";

function xml(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/xml" } });
}

function mockFetchByUrl(routes: Record<string, () => Response>) {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    const handler = routes[url];
    if (!handler) throw new Error(`unexpected fetch: ${url}`);
    return handler();
  });
}

describe("discoverSitemapUrls", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers URLs from a sitemap declared in robots.txt", async () => {
    mockFetchByUrl({
      "https://example.com/robots.txt": () =>
        new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        xml(
          "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>"
        ),
    });

    const urls = await discoverSitemapUrls("example.com");
    expect(urls.sort()).toEqual(["https://example.com/a", "https://example.com/b"]);
  });

  it("falls back to /sitemap.xml when robots.txt declares none", async () => {
    mockFetchByUrl({
      "https://example.com/robots.txt": () => new Response("User-agent: *\n", { status: 200 }),
      "https://example.com/sitemap.xml": () =>
        xml("<urlset><url><loc>https://example.com/only</loc></url></urlset>"),
    });

    expect(await discoverSitemapUrls("example.com")).toEqual(["https://example.com/only"]);
  });

  it("recurses one level into a sitemap index", async () => {
    mockFetchByUrl({
      "https://example.com/robots.txt": () =>
        new Response("User-agent: *\nSitemap: https://example.com/sitemap-index.xml\n", { status: 200 }),
      "https://example.com/sitemap-index.xml": () =>
        xml(
          "<sitemapindex><sitemap><loc>https://example.com/sitemap-1.xml</loc></sitemap>" +
            "<sitemap><loc>https://example.com/sitemap-2.xml</loc></sitemap></sitemapindex>"
        ),
      "https://example.com/sitemap-1.xml": () =>
        xml("<urlset><url><loc>https://example.com/p1</loc></url></urlset>"),
      "https://example.com/sitemap-2.xml": () =>
        xml("<urlset><url><loc>https://example.com/p2</loc></url></urlset>"),
    });

    const urls = await discoverSitemapUrls("example.com");
    expect(urls.sort()).toEqual(["https://example.com/p1", "https://example.com/p2"]);
  });

  it("filters out URLs disallowed by robots.txt", async () => {
    mockFetchByUrl({
      "https://example.com/robots.txt": () =>
        new Response("User-agent: *\nDisallow: /admin\nSitemap: https://example.com/sitemap.xml\n", {
          status: 200,
        }),
      "https://example.com/sitemap.xml": () =>
        xml(
          "<urlset><url><loc>https://example.com/admin/secret</loc></url>" +
            "<url><loc>https://example.com/blog/post</loc></url></urlset>"
        ),
    });

    expect(await discoverSitemapUrls("example.com")).toEqual(["https://example.com/blog/post"]);
  });

  it("respects the maxUrls cap", async () => {
    const urlsXml = Array.from({ length: 10 }, (_, i) => `<url><loc>https://example.com/p${i}</loc></url>`).join("");
    mockFetchByUrl({
      "https://example.com/robots.txt": () => new Response("User-agent: *\n", { status: 200 }),
      "https://example.com/sitemap.xml": () => xml(`<urlset>${urlsXml}</urlset>`),
    });

    expect(await discoverSitemapUrls("example.com", { maxUrls: 3 })).toHaveLength(3);
  });

  it("returns an empty list when the sitemap is unreachable", async () => {
    mockFetchByUrl({
      "https://example.com/robots.txt": () => new Response("User-agent: *\n", { status: 200 }),
      "https://example.com/sitemap.xml": () => new Response("nope", { status: 500 }),
    });

    expect(await discoverSitemapUrls("example.com")).toEqual([]);
  });
});
