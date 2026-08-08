import * as cheerio from "cheerio";
import type { ContactChannel } from "../types.js";
import { politeFetch } from "./http.js";

const SOCIAL_DOMAINS = ["twitter.com", "x.com", "linkedin.com", "facebook.com", "instagram.com"];

export interface ContactSignals {
  email: string | null;
  contactPageUrl: string | null;
  socialLinks: string[];
}

/**
 * Pure HTML → contact-signal extraction. Only ever reads links the page
 * itself published (`mailto:`, a page linked as "Contact", social profile
 * links) — never guesses or constructs an address, which is the line
 * between "surfacing a public contact channel" and building a prospecting/
 * spam tool.
 */
export function parseContactSignals(html: string): ContactSignals {
  const $ = cheerio.load(html);
  let email: string | null = null;
  let contactPageUrl: string | null = null;
  const socialLinks: string[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href")?.trim();
    if (!href) return;

    if (!email && href.toLowerCase().startsWith("mailto:")) {
      email = href.slice("mailto:".length).split("?")[0].trim();
      return;
    }

    if (SOCIAL_DOMAINS.some((domain) => href.includes(domain))) {
      socialLinks.push(href);
      return;
    }

    if (!contactPageUrl) {
      const text = $(el).text().trim().toLowerCase();
      if (href.toLowerCase().includes("contact") || text.includes("contact")) {
        contactPageUrl = href;
      }
    }
  });

  return { email, contactPageUrl, socialLinks: Array.from(new Set(socialLinks)) };
}

/**
 * Crawls a target's homepage (and its contact page, if linked) for publicly
 * published contact info. Returns null when nothing usable was found —
 * callers should treat that as "no channel," not retry with guessed emails.
 */
export async function discoverContactChannel(domain: string): Promise<ContactChannel | null> {
  const homepageUrl = `https://${domain}/`;
  let html: string;
  try {
    const res = await politeFetch(homepageUrl);
    if (!res.ok) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const signals = parseContactSignals(html);
  const resolvedContactPageUrl = signals.contactPageUrl ? resolveUrl(signals.contactPageUrl, homepageUrl) : null;

  if (!signals.email && resolvedContactPageUrl) {
    const contactPageSignals = await fetchContactPageSignals(resolvedContactPageUrl);
    if (contactPageSignals) {
      signals.email = signals.email ?? contactPageSignals.email;
      signals.socialLinks.push(...contactPageSignals.socialLinks);
    }
  }

  const socialLinks = Array.from(new Set(signals.socialLinks));
  if (!signals.email && !resolvedContactPageUrl && socialLinks.length === 0) return null;

  return {
    url: homepageUrl,
    email: signals.email,
    contactPageUrl: resolvedContactPageUrl,
    socialLinks,
  };
}

async function fetchContactPageSignals(contactPageUrl: string): Promise<ContactSignals | null> {
  try {
    const res = await politeFetch(contactPageUrl);
    if (!res.ok) return null;
    return parseContactSignals(await res.text());
  } catch {
    return null;
  }
}

function resolveUrl(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}
