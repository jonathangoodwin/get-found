import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type ReportSection =
  | "content-gap"
  | "striking-distance"
  | "ranking-watch"
  | "site-health"
  | "sitemap"
  | "core-web-vitals"
  | "link-gap"
  | "trends";

export const ALL_REPORT_SECTIONS: ReportSection[] = [
  "content-gap",
  "striking-distance",
  "ranking-watch",
  "site-health",
  "sitemap",
  "core-web-vitals",
  "link-gap",
  "trends",
];

export interface SlackConfig {
  site: string | null;
  competitors: string[];
  gscSiteUrl: string | null;
  /** Where the bot posts /run results and the daily report. */
  channelId: string | null;
  dailyReportEnabled: boolean;
  dailyReportHourUtc: number;
  dailyReportMinuteUtc: number;
  /** Post every day regardless, or only when something actually changed. */
  dailyReportOnlyOnChange: boolean;
  dailyReportSections: ReportSection[];
  /** Opt-in: hits the paid DataForSEO Backlinks API and crawls each target for a contact channel. Off by default. */
  linkGapEnabled: boolean;
  /** Opt-in: polls Google's real-time trending-searches feed against tracked topics. Off by default. */
  trendsEnabled: boolean;
  trendsGeo: string;
  /**
   * Trend-watch: user-defined keyword themes, expanded (Claude if available) and checked against
   * real Google Trends interest-over-time data on a user-set interval. A different mechanism from
   * trendsEnabled above (that one matches this run's own topics against general trending searches;
   * this one tracks specific keywords for a spike, on their own schedule, independent of /run).
   */
  trendWatchEnabled: boolean;
  trendWatchThemes: string[];
  trendWatchIntervalDays: number;
  trendWatchThresholdPercent: number;
  trendWatchLastRunAt: string | null;
}

export const DEFAULT_CONFIG_PATH = ".get-found/slack-config.json";

export const DEFAULT_SLACK_CONFIG: SlackConfig = {
  site: null,
  competitors: [],
  gscSiteUrl: null,
  channelId: null,
  dailyReportEnabled: false,
  dailyReportHourUtc: 13,
  dailyReportMinuteUtc: 0,
  dailyReportOnlyOnChange: true,
  dailyReportSections: [...ALL_REPORT_SECTIONS],
  linkGapEnabled: false,
  trendsEnabled: false,
  trendsGeo: "US",
  trendWatchEnabled: false,
  trendWatchThemes: [],
  trendWatchIntervalDays: 7,
  trendWatchThresholdPercent: 50,
  trendWatchLastRunAt: null,
};

export interface ConfigStore {
  load(): Promise<SlackConfig>;
  save(config: SlackConfig): Promise<void>;
}

/** Single active config per bot instance — one site/workspace at a time, not multi-tenant. */
export class FileConfigStore implements ConfigStore {
  constructor(private readonly path: string = DEFAULT_CONFIG_PATH) {}

  async load(): Promise<SlackConfig> {
    try {
      const raw = await readFile(this.path, "utf-8");
      return { ...DEFAULT_SLACK_CONFIG, ...(JSON.parse(raw) as Partial<SlackConfig>) };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { ...DEFAULT_SLACK_CONFIG };
      throw err;
    }
  }

  async save(config: SlackConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(config, null, 2), "utf-8");
  }
}

export interface ConfigCommandResult {
  config: SlackConfig;
  message: string;
  changed: boolean;
}

/**
 * Pure parser for `/get-found config ...` — kept free of any Slack SDK
 * dependency so the command grammar is unit-testable without mocking Bolt.
 */
export function applyConfigCommand(args: string[], config: SlackConfig): ConfigCommandResult {
  if (args.length === 0) {
    return { config, message: describeConfig(config), changed: false };
  }

  const [key, ...valueParts] = args;
  const value = valueParts.join(" ").trim();
  const next: SlackConfig = { ...config };

  switch (key) {
    case "site":
      next.site = value || null;
      break;
    case "competitors":
      next.competitors = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
      break;
    case "gsc-site-url":
      next.gscSiteUrl = value || null;
      break;
    case "channel":
      next.channelId = value || null;
      break;
    case "daily":
      next.dailyReportEnabled = value === "on" || value === "true";
      break;
    case "daily-only-on-change":
      next.dailyReportOnlyOnChange = value === "on" || value === "true";
      break;
    case "daily-time": {
      const match = /^(\d{1,2}):(\d{2})$/.exec(value);
      if (!match) {
        return { config, message: `Invalid time "${value}" — expected HH:MM in UTC, e.g. 13:00.`, changed: false };
      }
      next.dailyReportHourUtc = Number(match[1]);
      next.dailyReportMinuteUtc = Number(match[2]);
      break;
    }
    case "daily-sections": {
      const requested = value.split(",").map((s) => s.trim()).filter(Boolean);
      const invalid = requested.filter((s) => !ALL_REPORT_SECTIONS.includes(s as ReportSection));
      if (invalid.length > 0) {
        return {
          config,
          message: `Unknown section(s): ${invalid.join(", ")}. Valid: ${ALL_REPORT_SECTIONS.join(", ")}.`,
          changed: false,
        };
      }
      next.dailyReportSections = requested.length > 0 ? (requested as ReportSection[]) : [...ALL_REPORT_SECTIONS];
      break;
    }
    case "link-gap":
      next.linkGapEnabled = value === "on" || value === "true";
      break;
    case "trends":
      next.trendsEnabled = value === "on" || value === "true";
      break;
    case "trends-geo":
      next.trendsGeo = value || "US";
      break;
    case "trend-watch":
      next.trendWatchEnabled = value === "on" || value === "true";
      break;
    case "trend-watch-themes":
      next.trendWatchThemes = value ? value.split(",").map((s) => s.trim()).filter(Boolean) : [];
      break;
    case "trend-watch-interval": {
      const days = Number(value);
      if (!Number.isFinite(days) || days <= 0) {
        return { config, message: `Invalid interval "${value}" — expected a positive number of days.`, changed: false };
      }
      next.trendWatchIntervalDays = days;
      break;
    }
    case "trend-watch-threshold": {
      const percent = Number(value);
      if (!Number.isFinite(percent) || percent <= 0) {
        return { config, message: `Invalid threshold "${value}" — expected a positive percentage.`, changed: false };
      }
      next.trendWatchThresholdPercent = percent;
      break;
    }
    default:
      return {
        config,
        message: `Unknown config key "${key}".\n\n${describeConfig(config)}`,
        changed: false,
      };
  }

  return { config: next, message: describeConfig(next), changed: true };
}

export function describeConfig(config: SlackConfig): string {
  return [
    `*site:* ${config.site ?? "_not set_"}`,
    `*competitors:* ${config.competitors.length > 0 ? config.competitors.join(", ") : "_none_"}`,
    `*gsc-site-url:* ${config.gscSiteUrl ?? "_not set_"}`,
    `*channel:* ${config.channelId ?? "_not set_"}`,
    `*daily:* ${config.dailyReportEnabled ? "on" : "off"} at ${pad(config.dailyReportHourUtc)}:${pad(config.dailyReportMinuteUtc)} UTC`,
    `*daily-only-on-change:* ${config.dailyReportOnlyOnChange ? "on" : "off"}`,
    `*daily-sections:* ${config.dailyReportSections.join(", ")}`,
    `*link-gap:* ${config.linkGapEnabled ? "on (uses paid DataForSEO Backlinks API)" : "off"}`,
    `*trends:* ${config.trendsEnabled ? `on (geo: ${config.trendsGeo})` : "off"}`,
    `*trend-watch:* ${config.trendWatchEnabled ? "on" : "off"} · themes: ${config.trendWatchThemes.length > 0 ? config.trendWatchThemes.join(", ") : "_none_"} · every ${config.trendWatchIntervalDays}d · threshold +${config.trendWatchThresholdPercent}%`,
  ].join("\n");
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
