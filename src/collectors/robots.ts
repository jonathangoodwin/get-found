/**
 * Minimal robots.txt parser — enough to respect Disallow rules for "*" and
 * our own user-agent before crawling a domain we don't own.
 */
import { politeFetch, USER_AGENT } from "./http.js";

export interface RobotsRules {
  disallow: string[];
  crawlDelaySeconds: number | null;
}

export async function fetchRobotsRules(domain: string): Promise<RobotsRules> {
  const url = `https://${domain}/robots.txt`;
  let text: string;
  try {
    const res = await politeFetch(url);
    if (!res.ok) return { disallow: [], crawlDelaySeconds: null };
    text = await res.text();
  } catch {
    return { disallow: [], crawlDelaySeconds: null };
  }
  return parseRobotsTxt(text);
}

export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const disallow: string[] = [];
  let crawlDelaySeconds: number | null = null;
  let inRelevantGroup = false;

  for (const rawLine of lines) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const [rawKey, ...rest] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inRelevantGroup = value === "*" || value.toLowerCase() === USER_AGENT;
    } else if (inRelevantGroup && key === "disallow" && value) {
      disallow.push(value);
    } else if (inRelevantGroup && key === "crawl-delay") {
      const parsed = Number(value);
      if (!Number.isNaN(parsed)) crawlDelaySeconds = parsed;
    }
  }
  return { disallow, crawlDelaySeconds };
}

export function isAllowedByRobots(path: string, rules: RobotsRules): boolean {
  return !rules.disallow.some((rule) => rule && path.startsWith(rule));
}
