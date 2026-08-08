import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverContactChannel, parseContactSignals } from "../../src/collectors/outreach-contact.js";

describe("parseContactSignals", () => {
  it("extracts a mailto address", () => {
    const html = `<a href="mailto:hello@example.com">Email us</a>`;
    expect(parseContactSignals(html).email).toBe("hello@example.com");
  });

  it("strips query params from a mailto address", () => {
    const html = `<a href="mailto:hello@example.com?subject=Hi">Email us</a>`;
    expect(parseContactSignals(html).email).toBe("hello@example.com");
  });

  it("finds a contact page link by href", () => {
    const html = `<a href="/contact-us">Get in touch</a>`;
    expect(parseContactSignals(html).contactPageUrl).toBe("/contact-us");
  });

  it("finds a contact page link by link text when the href doesn't say 'contact'", () => {
    const html = `<a href="/reach-out">Contact</a>`;
    expect(parseContactSignals(html).contactPageUrl).toBe("/reach-out");
  });

  it("collects social profile links and dedupes them", () => {
    const html = `
      <a href="https://twitter.com/example">Twitter</a>
      <a href="https://linkedin.com/company/example">LinkedIn</a>
      <a href="https://twitter.com/example">Twitter again</a>
    `;
    expect(parseContactSignals(html).socialLinks.sort()).toEqual(
      ["https://linkedin.com/company/example", "https://twitter.com/example"].sort()
    );
  });

  it("returns nulls and an empty array for a page with no signals", () => {
    const html = `<a href="/about">About</a><a href="/blog">Blog</a>`;
    expect(parseContactSignals(html)).toEqual({ email: null, contactPageUrl: null, socialLinks: [] });
  });

  it("does not invent or guess an email when none is published", () => {
    const html = `<p>Contact John Smith, our CEO, for inquiries.</p>`;
    expect(parseContactSignals(html).email).toBeNull();
  });
});

describe("discoverContactChannel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns a channel when the homepage has a mailto link", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(`<a href="mailto:info@target.com">Email</a>`, { status: 200 })
    );

    const channel = await discoverContactChannel("target.com");

    expect(channel).toEqual({ url: "https://target.com/", email: "info@target.com", contactPageUrl: null, socialLinks: [] });
  });

  it("follows a linked contact page to find an email not on the homepage", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(`<a href="/contact">Contact</a>`, { status: 200 }))
      .mockResolvedValueOnce(new Response(`<a href="mailto:team@target.com">Email</a>`, { status: 200 }));

    const channel = await discoverContactChannel("target.com");

    expect(channel?.email).toBe("team@target.com");
    expect(channel?.contactPageUrl).toBe("https://target.com/contact");
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe("https://target.com/contact");
  });

  it("returns null when the homepage has no contact signals at all", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(`<a href="/about">About</a>`, { status: 200 }));
    expect(await discoverContactChannel("target.com")).toBeNull();
  });

  it("returns null when the homepage fails to fetch", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("not found", { status: 404 }));
    expect(await discoverContactChannel("target.com")).toBeNull();
  });

  it("returns null rather than throwing on a network error", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("timed out"));
    expect(await discoverContactChannel("target.com")).toBeNull();
  });

  it("still returns a channel from homepage signals if the contact page fetch fails", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(`<a href="/contact">Contact</a><a href="https://twitter.com/target">Twitter</a>`, { status: 200 })
      )
      .mockResolvedValueOnce(new Response("server error", { status: 500 }));

    const channel = await discoverContactChannel("target.com");

    expect(channel?.contactPageUrl).toBe("https://target.com/contact");
    expect(channel?.socialLinks).toEqual(["https://twitter.com/target"]);
    expect(channel?.email).toBeNull();
  });
});
