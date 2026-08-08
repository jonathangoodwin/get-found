#!/usr/bin/env node
import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { Command } from "commander";
import { DEFAULT_HISTORY_DIR } from "./history/store.js";
import { runAnalysis } from "./orchestrate.js";
import { renderMarkdownReport } from "./report/markdown.js";
import { createSlackBot } from "./slack/bot.js";
import { DEFAULT_CONFIG_PATH, FileConfigStore } from "./slack/config.js";

const program = new Command();

program
  .name("get-found")
  .description("Crawl your site and competitors, pull Search Console data, and produce a ranked content-gap report.");

program
  .command("run")
  .requiredOption("--site <domain>", "your domain, e.g. example.com")
  .option("--competitors <domains>", "comma-separated competitor domains", "")
  .option("--gsc-site-url <url>", 'Search Console property, e.g. "https://example.com/" or "sc-domain:example.com"')
  .option("--max-pages <n>", "max pages to crawl per domain", "200")
  .option("--out <file>", "output markdown file (defaults to stdout)")
  .option("--briefs <n>", "draft content briefs for the top N opportunities (0 to skip)", "10")
  .option("--no-ai", "never use Claude for briefs, even if ANTHROPIC_API_KEY is set")
  .option("--business-context <text>", "one-line business context to sharpen AI-drafted briefs")
  .option("--history-dir <path>", "where run snapshots are saved for diffing against future runs", DEFAULT_HISTORY_DIR)
  .option("--no-save-history", "don't save this run's snapshot (still diffs against prior runs if any exist)")
  .option("--thin-content-words <n>", "word-count floor below which a page is flagged as thin content", "300")
  .option("--cwv-pages <n>", "how many of the own site's pages to pull Core Web Vitals for", "5")
  .action(async (opts) => {
    const competitors: string[] = opts.competitors
      ? opts.competitors.split(",").map((d: string) => d.trim()).filter(Boolean)
      : [];

    const result = await runAnalysis({
      site: opts.site,
      competitors,
      gscSiteUrl: opts.gscSiteUrl,
      maxPages: Number(opts.maxPages),
      thinContentWordCount: Number(opts.thinContentWords),
      cwvPages: Number(opts.cwvPages),
      historyDir: opts.historyDir,
      saveHistory: opts.saveHistory !== false,
      briefsLimit: Number(opts.briefs),
      useAi: opts.ai !== false,
      businessContext: opts.businessContext,
      onProgress: (message) => console.error(message),
    });

    const markdown = renderMarkdownReport(result.report, {
      briefs: result.briefs,
      diff: result.diff,
      healthFindings: result.healthFindings,
      sitemapStatuses: result.sitemapStatuses,
      coreWebVitals: result.coreWebVitals,
    });

    if (opts.out) {
      await writeFile(opts.out, markdown, "utf-8");
      console.error(`Report written to ${opts.out}`);
    } else {
      console.log(markdown);
    }
  });

program
  .command("slack")
  .description("Start the Slack bot (Socket Mode) — /get-found run|latest|config|help, plus the daily report.")
  .option("--history-dir <path>", "where run snapshots are read/saved", DEFAULT_HISTORY_DIR)
  .option("--config-path <path>", "where the Slack config (site, competitors, schedule) is stored", DEFAULT_CONFIG_PATH)
  .action(async (opts) => {
    const botToken = process.env.SLACK_BOT_TOKEN;
    const appToken = process.env.SLACK_APP_TOKEN;
    if (!botToken || !appToken) {
      console.error("Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN in .env first — see README for Slack app setup.");
      process.exitCode = 1;
      return;
    }

    const bot = createSlackBot({
      botToken,
      appToken,
      historyDir: opts.historyDir,
      configStore: new FileConfigStore(opts.configPath),
    });

    await bot.start();
    console.error("get-found Slack bot running. Try /get-found help in Slack.");

    process.on("SIGINT", () => void bot.stop().then(() => process.exit(0)));
    process.on("SIGTERM", () => void bot.stop().then(() => process.exit(0)));
  });

program.parseAsync(process.argv);
