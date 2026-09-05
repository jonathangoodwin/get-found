import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crawlSite, fetchPageRecord, parsePageHtml, resolveCrawlDelayMs } from "../../src/collectors/crawl.js";

describe("parsePageHtml", () => {
  it("extracts title, meta description, headings, canonical, schema, and word count", () => {
    const html = `
      <html><head>
        <title>Memory Care Guide</title>
        <meta name="description" content="A guide to memory care.">
        <link rel="canonical" href="https://example.com/canonical">
        <script type="application/ld+json">{"@type":"Article"}</script>
      </head><body>
        <h1>Memory Care Guide</h1>
        <h2>What is memory care</h2>
        <h2>How much does it cost</h2>
        <h3>Monthly fees</h3>
        <p>Some body copy that has a handful of words in it.</p>
      </body></html>`;

    const page = parsePageHtml("https://example.com/guide", "example.com", html);

    expect(page.title).toBe("Memory Care Guide");
    expect(page.metaDescription).toBe("A guide to memory care.");
    expect(page.canonicalUrl).toBe("https://example.com/canonical");
    expect(page.hasSchema).toBe(true);
    expect(page.h1).toEqual(["Memory Care Guide"]);
    expect(page.h2).toEqual(["What is memory care", "How much does it cost"]);
    expect(page.h3).toEqual(["Monthly fees"]);
    expect(page.wordCount).toBeGreaterThan(0);
  });

  it("returns nulls and empty arrays for a bare page", () => {
    const page = parsePageHtml("https://example.com/bare", "example.com", "<html><body></body></html>");
    expect(page.title).toBeNull();
    expect(page.metaDescription).toBeNull();
    expect(page.canonicalUrl).toBeNull();
    expect(page.hasSchema).toBe(false);
    expect(page.h1).toEqual([]);
    expect(page.wordCount).toBe(0);
    expect(page.internalLinks).toEqual([]);
  });

  it("collects same-domain links, resolving relative hrefs to absolute URLs", () => {
    const html = `<html><body>
      <a href="/blog/post-1">Post 1</a>
      <a href="https://example.com/blog/post-2">Post 2</a>
      <a href="other-page">Relative</a>
    </body></html>`;
    const page = parsePageHtml("https://example.com/blog/", "example.com", html);
    expect(page.internalLinks.sort()).toEqual([
      "https://example.com/blog/other-page",
      "https://example.com/blog/post-1",
      "https://example.com/blog/post-2",
    ]);
  });

  it("treats www and bare domain as the same site", () => {
    const html = `<a href="https://www.example.com/page">link</a>`;
    const page = parsePageHtml("https://example.com/", "example.com", html);
    expect(page.internalLinks).toEqual(["https://www.example.com/page"]);
  });

  it("excludes external domains, mailto/tel/javascript hrefs, and hash-only anchors", () => {
    const html = `<html><body>
      <a href="https://other-site.com/page">external</a>
      <a href="mailto:hi@example.com">email</a>
      <a href="tel:+15551234567">phone</a>
      <a href="javascript:void(0)">js</a>
      <a href="#section">anchor</a>
    </body></html>`;
    const page = parsePageHtml("https://example.com/", "example.com", html);
    expect(page.internalLinks).toEqual([]);
  });

  it("strips the hash fragment and dedupes links to the same URL", () => {
    const html = `<html><body>
      <a href="/page">a</a>
      <a href="/page#section-1">b</a>
      <a href="/page#section-2">c</a>
    </body></html>`;
    const page = parsePageHtml("https://example.com/", "example.com", html);
    expect(page.internalLinks).toEqual(["https://example.com/page"]);
  });
});

describe("fetchPageRecord", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a parsed page on a successful HTML response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("<html><head><title>Hi</title></head><body></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      })
    );
    const page = await fetchPageRecord("https://example.com/a", "example.com");
    expect(page?.title).toBe("Hi");
  });

  it("returns null on a non-2xx response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("server error", { status: 500 }));
    expect(await fetchPageRecord("https://example.com/a", "example.com")).toBeNull();
  });

  it("returns null for non-HTML content types", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("%PDF-1.4", { status: 200, headers: { "content-type": "application/pdf" } })
    );
    expect(await fetchPageRecord("https://example.com/doc.pdf", "example.com")).toBeNull();
  });

  it("returns null rather than throwing on a network error or timeout", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timed out"));
    expect(await fetchPageRecord("https://example.com/a", "example.com")).toBeNull();
  });
});

describe("resolveCrawlDelayMs", () => {
  it("uses the requested delay when robots.txt declares no Crawl-delay", () => {
    expect(resolveCrawlDelayMs(250, { disallow: [], crawlDelaySeconds: null })).toBe(250);
  });

  it("raises the delay to match a longer robots.txt Crawl-delay", () => {
    expect(resolveCrawlDelayMs(250, { disallow: [], crawlDelaySeconds: 2 })).toBe(2000);
  });

  it("keeps the requested delay when it already exceeds robots.txt Crawl-delay", () => {
    expect(resolveCrawlDelayMs(5000, { disallow: [], crawlDelaySeconds: 1 })).toBe(5000);
  });
});

describe("crawlSite", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("discovers pages via the sitemap and crawls each one", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) {
        return new Response("User-agent: *\nSitemap: https://example.com/sitemap.xml\n", { status: 200 });
      }
      if (url === "https://example.com/sitemap.xml") {
        return new Response(
          "<urlset><url><loc>https://example.com/a</loc></url><url><loc>https://example.com/b</loc></url></urlset>",
          { status: 200 }
        );
      }
      return new Response(`<html><head><title>${url}</title></head><body></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const site = await crawlSite("example.com", { maxPages: 10, delayMs: 0 });

    expect(site.domain).toBe("example.com");
    expect(site.pages.map((p) => p.url).sort()).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(site.pages.every((p) => p.title)).toBe(true);
  });

  it("skips pages that fail to fetch without failing the whole crawl", async () => {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.endsWith("/robots.txt")) return new Response("User-agent: *\n", { status: 200 });
      if (url === "https://example.com/sitemap.xml") {
        return new Response(
          "<urlset><url><loc>https://example.com/ok</loc></url><url><loc>https://example.com/broken</loc></url></urlset>",
          { status: 200 }
        );
      }
      if (url === "https://example.com/broken") return new Response("not found", { status: 404 });
      return new Response("<html><head><title>ok</title></head><body></body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });

    const site = await crawlSite("example.com", { maxPages: 10, delayMs: 0 });
    expect(site.pages).toHaveLength(1);
    expect(site.pages[0].url).toBe("https://example.com/ok");
  });
});
