import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRobotsRules, isAllowedByRobots, parseRobotsTxt } from "../../src/collectors/robots.js";

describe("parseRobotsTxt", () => {
  it("collects Disallow rules under the wildcard user-agent group", () => {
    const text = [
      "User-agent: *",
      "Disallow: /admin",
      "Disallow: /private/",
      "",
      "User-agent: SomeOtherBot",
      "Disallow: /only-for-other-bot",
    ].join("\n");

    expect(parseRobotsTxt(text).disallow).toEqual(["/admin", "/private/"]);
  });

  it("also matches rules addressed to our own user-agent", () => {
    const text = "User-agent: get-found\nDisallow: /no-scrapers\n";
    expect(parseRobotsTxt(text).disallow).toEqual(["/no-scrapers"]);
  });

  it("parses Crawl-delay when present", () => {
    expect(parseRobotsTxt("User-agent: *\nCrawl-delay: 5\n").crawlDelaySeconds).toBe(5);
  });

  it("leaves crawlDelaySeconds null when absent", () => {
    expect(parseRobotsTxt("User-agent: *\nDisallow: /x\n").crawlDelaySeconds).toBeNull();
  });

  it("ignores comments and blank lines", () => {
    const rules = parseRobotsTxt("# comment\nUser-agent: *\n\nDisallow: /x # trailing comment\n");
    expect(rules.disallow).toEqual(["/x"]);
  });
});

describe("isAllowedByRobots", () => {
  const rules = { disallow: ["/admin", "/private"], crawlDelaySeconds: null };

  it("blocks paths under a disallowed prefix", () => {
    expect(isAllowedByRobots("/admin/users", rules)).toBe(false);
  });

  it("allows paths outside every disallowed prefix", () => {
    expect(isAllowedByRobots("/blog/post-1", rules)).toBe(true);
  });
});

describe("fetchRobotsRules", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches and parses robots.txt, identifying itself via User-Agent", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("User-agent: *\nDisallow: /admin\n", { status: 200 }));

    const rules = await fetchRobotsRules("example.com");

    expect(rules.disallow).toEqual(["/admin"]);
    expect(fetch).toHaveBeenCalledWith(
      "https://example.com/robots.txt",
      expect.objectContaining({ headers: expect.objectContaining({ "User-Agent": "get-found" }) })
    );
  });

  it("returns empty rules when robots.txt is missing", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await fetchRobotsRules("example.com")).toEqual({ disallow: [], crawlDelaySeconds: null });
  });

  it("returns empty rules on a network error or timeout rather than throwing", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timed out"));
    expect(await fetchRobotsRules("example.com")).toEqual({ disallow: [], crawlDelaySeconds: null });
  });
});
