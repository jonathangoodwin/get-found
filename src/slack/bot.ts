import { App } from "@slack/bolt";
import { FileHistoryStore } from "../history/store.js";
import { runAnalysis } from "../orchestrate.js";
import { runTrendWatch } from "../trend-watch.js";
import { applyConfigCommand, FileConfigStore, type ConfigStore, type SlackConfig } from "./config.js";
import { formatReportBlocks, formatTrendWatchBlocks, type SlackBlock } from "./format.js";
import { RunGuard } from "./guards.js";
import { scheduleDaily, scheduleInterval } from "./schedule.js";

export interface SlackBotOptions {
  botToken: string;
  appToken: string;
  configStore?: ConfigStore;
  historyDir?: string;
  minRunIntervalMs?: number;
}

export interface SlackBot {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const HELP_TEXT = [
  "*get-found* commands:",
  "• `/get-found run` — crawl and analyze the configured site now",
  "• `/get-found latest` — show the most recently saved report (no crawl)",
  "• `/get-found config` — view current configuration",
  "• `/get-found config <key> <value>` — set `site`, `competitors`, `gsc-site-url`, `channel`, `daily`, `daily-only-on-change`, `daily-time` (HH:MM UTC), `daily-sections`, `link-gap` (on/off — paid, drafts outreach too), `trends` (on/off — free, checks Google's real-time trending searches), `trends-geo` (region code, default US), `trend-watch` (on/off — tracks your own keyword themes against real Google Trends data), `trend-watch-themes` (comma list), `trend-watch-interval` (days between checks, default 7), `trend-watch-threshold` (% rise to alert on, default 50)",
  "• `/get-found trends-watch` — run a keyword-theme trend check now, outside its schedule",
  "• `/get-found help` — this message",
].join("\n");

export function createSlackBot(opts: SlackBotOptions): SlackBot {
  const app = new App({ token: opts.botToken, appToken: opts.appToken, socketMode: true });
  const configStore = opts.configStore ?? new FileConfigStore();
  const historyStore = new FileHistoryStore(opts.historyDir);
  const guard = new RunGuard({ minIntervalMs: opts.minRunIntervalMs });

  app.command("/get-found", async ({ command, ack, respond }) => {
    await ack();
    const [subcommand, ...rest] = command.text.trim().split(/\s+/).filter(Boolean);

    if (subcommand === "run") {
      const blocked = guard.check();
      if (blocked) {
        await respond(blocked);
        return;
      }

      const config = await configStore.load();
      if (!config.site) {
        await respond('No site configured yet. Try `/get-found config site example.com`.');
        return;
      }

      await respond(`On it — analyzing ${config.site}. I'll post results here when done.`);
      guard.start();
      runAndPost(config, command.channel_id).finally(() => guard.finish());
      return;
    }

    if (subcommand === "latest") {
      const config = await configStore.load();
      if (!config.site) {
        await respond('No site configured yet. Try `/get-found config site example.com`.');
        return;
      }
      const latest = await historyStore.loadLatest(config.site);
      if (!latest) {
        await respond("No saved report yet for this site — run `/get-found run` first.");
        return;
      }
      // formatReportBlocks returns our own lightweight structural block type (see format.ts's
      // rationale) rather than the SDK's strict discriminated union — valid Block Kit JSON either way.
      await respond({ blocks: formatReportBlocks({ report: latest }) as any });
      return;
    }

    if (subcommand === "config") {
      const current = await configStore.load();
      const result = applyConfigCommand(rest, current);
      if (result.changed) await configStore.save(result.config);
      await respond(result.message);
      return;
    }

    if (subcommand === "trends-watch") {
      const blocked = guard.check();
      if (blocked) {
        await respond(blocked);
        return;
      }

      const config = await configStore.load();
      if (config.trendWatchThemes.length === 0) {
        await respond('No trend-watch themes configured yet. Try `/get-found config trend-watch-themes "theme one, theme two"`.');
        return;
      }

      await respond(`On it — checking ${config.trendWatchThemes.length} keyword theme(s) against Google Trends.`);
      guard.start();
      runTrendWatchAndPost(config, command.channel_id).finally(() => guard.finish());
      return;
    }

    await respond(HELP_TEXT);
  });

  async function runTrendWatchAndPost(config: SlackConfig, channelId: string): Promise<void> {
    try {
      const result = await runTrendWatch({
        themes: config.trendWatchThemes,
        geo: config.trendsGeo,
        deltaThresholdPercent: config.trendWatchThresholdPercent,
      });
      await configStore.save({ ...(await configStore.load()), trendWatchLastRunAt: new Date().toISOString() });
      await postBlocks(channelId, "Google Trends keyword watch", formatTrendWatchBlocks(result));
    } catch (err) {
      await app.client.chat.postMessage({
        channel: channelId,
        text: `Trend watch failed: ${(err as Error).message}`,
      });
    }
  }

  async function runAndPost(config: SlackConfig, channelId: string): Promise<void> {
    try {
      const result = await runAnalysis({
        site: config.site!,
        competitors: config.competitors,
        gscSiteUrl: config.gscSiteUrl ?? undefined,
        historyDir: opts.historyDir,
        enableLinkGap: config.linkGapEnabled,
        enableTrends: config.trendsEnabled,
        trendsGeo: config.trendsGeo,
      });
      const blocks = formatReportBlocks({
        report: result.report,
        diff: result.diff,
        healthFindings: result.healthFindings,
        sitemapStatuses: result.sitemapStatuses,
        coreWebVitals: result.coreWebVitals,
        contacts: result.contacts,
        trendSignals: result.trendSignals,
      });
      await postBlocks(channelId, `SEO report for ${config.site}`, blocks);
    } catch (err) {
      await app.client.chat.postMessage({
        channel: channelId,
        text: `Analysis of ${config.site} failed: ${(err as Error).message}`,
      });
    }
  }

  async function postBlocks(channelId: string, fallbackText: string, blocks: SlackBlock[]): Promise<void> {
    await app.client.chat.postMessage({
      channel: channelId,
      text: fallbackText,
      blocks: blocks as any, // see comment on the /latest handler above
    });
  }

  const scheduler = scheduleDaily(
    async () => {
      const config = await configStore.load();
      if (!config.dailyReportEnabled || !config.site || !config.channelId) return;
      if (guard.check()) return; // a manual run is in flight or just finished — skip this tick, try again tomorrow

      guard.start();
      try {
        const result = await runAnalysis({
          site: config.site,
          competitors: config.competitors,
          gscSiteUrl: config.gscSiteUrl ?? undefined,
          historyDir: opts.historyDir,
          enableLinkGap: config.linkGapEnabled,
          enableTrends: config.trendsEnabled,
          trendsGeo: config.trendsGeo,
        });

        const totalChanges = result.diff
          ? result.diff.newOpportunities.length + result.diff.resolvedOpportunities.length + result.diff.changedOpportunities.length
          : null;
        if (config.dailyReportOnlyOnChange && totalChanges === 0) return;

        const blocks = formatReportBlocks(
          {
            report: result.report,
            diff: result.diff,
            healthFindings: result.healthFindings,
            sitemapStatuses: result.sitemapStatuses,
            coreWebVitals: result.coreWebVitals,
            contacts: result.contacts,
            trendSignals: result.trendSignals,
          },
          config.dailyReportSections
        );
        await postBlocks(config.channelId, `Daily SEO report for ${config.site}`, blocks);
      } catch (err) {
        await app.client.chat.postMessage({
          channel: config.channelId,
          text: `Daily analysis of ${config.site} failed: ${(err as Error).message}`,
        });
      } finally {
        guard.finish();
      }
    },
    {
      getSchedule: async () => {
        const config = await configStore.load();
        return config.dailyReportEnabled ? { hourUtc: config.dailyReportHourUtc, minuteUtc: config.dailyReportMinuteUtc } : null;
      },
    }
  );

  const trendWatchScheduler = scheduleInterval(
    async () => {
      const config = await configStore.load();
      if (!config.trendWatchEnabled || config.trendWatchThemes.length === 0 || !config.channelId) return;
      if (guard.check()) return; // a manual run is in flight or just finished — skip this tick, try again next check

      guard.start();
      try {
        await runTrendWatchAndPost(config, config.channelId);
      } finally {
        guard.finish();
      }
    },
    {
      getState: async () => {
        const config = await configStore.load();
        return {
          enabled: config.trendWatchEnabled,
          intervalDays: config.trendWatchIntervalDays,
          lastRunAt: config.trendWatchLastRunAt,
        };
      },
    }
  );

  return {
    start: async () => {
      await app.start();
    },
    stop: async () => {
      scheduler.stop();
      trendWatchScheduler.stop();
      await app.stop();
    },
  };
}
