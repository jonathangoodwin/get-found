import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyConfigCommand, DEFAULT_SLACK_CONFIG, FileConfigStore, type SlackConfig } from "../../src/slack/config.js";

describe("FileConfigStore", () => {
  let dir: string;
  let path: string;
  let store: FileConfigStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "get-found-slack-config-"));
    path = join(dir, "nested", "config.json");
    store = new FileConfigStore(path);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns the default config when nothing has been saved", async () => {
    expect(await store.load()).toEqual(DEFAULT_SLACK_CONFIG);
  });

  it("round-trips a saved config, creating parent directories as needed", async () => {
    const config: SlackConfig = { ...DEFAULT_SLACK_CONFIG, site: "example.com", competitors: ["comp.com"] };
    await store.save(config);
    expect(await store.load()).toEqual(config);
  });

  it("fills in missing fields from defaults when loading an older/partial config file", async () => {
    await store.save({ ...DEFAULT_SLACK_CONFIG, site: "example.com" } as SlackConfig);
    const loaded = await store.load();
    expect(loaded.site).toBe("example.com");
    expect(loaded.dailyReportSections).toEqual(DEFAULT_SLACK_CONFIG.dailyReportSections);
  });
});

describe("applyConfigCommand", () => {
  it("describes the current config when called with no arguments", () => {
    const result = applyConfigCommand([], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(false);
    expect(result.message).toContain("_not set_");
  });

  it("sets the site", () => {
    const result = applyConfigCommand(["site", "example.com"], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(true);
    expect(result.config.site).toBe("example.com");
  });

  it("clears the site when given an empty value", () => {
    const withSite = { ...DEFAULT_SLACK_CONFIG, site: "example.com" };
    const result = applyConfigCommand(["site"], withSite);
    expect(result.config.site).toBeNull();
  });

  it("parses a comma-separated competitor list, trimming whitespace", () => {
    const result = applyConfigCommand(["competitors", "a.com, b.com,c.com"], DEFAULT_SLACK_CONFIG);
    expect(result.config.competitors).toEqual(["a.com", "b.com", "c.com"]);
  });

  it("toggles the daily report on/off", () => {
    expect(applyConfigCommand(["daily", "on"], DEFAULT_SLACK_CONFIG).config.dailyReportEnabled).toBe(true);
    expect(applyConfigCommand(["daily", "off"], DEFAULT_SLACK_CONFIG).config.dailyReportEnabled).toBe(false);
  });

  it("parses a valid daily-time", () => {
    const result = applyConfigCommand(["daily-time", "9:30"], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(true);
    expect(result.config.dailyReportHourUtc).toBe(9);
    expect(result.config.dailyReportMinuteUtc).toBe(30);
  });

  it("rejects a malformed daily-time without changing the config", () => {
    const result = applyConfigCommand(["daily-time", "not-a-time"], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(false);
    expect(result.config).toBe(DEFAULT_SLACK_CONFIG);
    expect(result.message).toContain("Invalid time");
  });

  it("sets a valid subset of daily-sections", () => {
    const result = applyConfigCommand(["daily-sections", "content-gap, site-health"], DEFAULT_SLACK_CONFIG);
    expect(result.config.dailyReportSections).toEqual(["content-gap", "site-health"]);
  });

  it("rejects an unknown daily-sections value without changing the config", () => {
    const result = applyConfigCommand(["daily-sections", "not-a-real-section"], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(false);
    expect(result.message).toContain("Unknown section");
  });

  it("rejects an unknown config key without changing the config", () => {
    const result = applyConfigCommand(["bogus-key", "value"], DEFAULT_SLACK_CONFIG);
    expect(result.changed).toBe(false);
    expect(result.message).toContain('Unknown config key "bogus-key"');
  });

  it("toggles link-gap on/off, defaulting off", () => {
    expect(DEFAULT_SLACK_CONFIG.linkGapEnabled).toBe(false);
    expect(applyConfigCommand(["link-gap", "on"], DEFAULT_SLACK_CONFIG).config.linkGapEnabled).toBe(true);
    expect(applyConfigCommand(["link-gap", "off"], DEFAULT_SLACK_CONFIG).config.linkGapEnabled).toBe(false);
  });

  it("notes the paid API in the description when link-gap is on", () => {
    const withLinkGap = { ...DEFAULT_SLACK_CONFIG, linkGapEnabled: true };
    const result = applyConfigCommand([], withLinkGap);
    expect(result.message).toContain("paid DataForSEO Backlinks API");
  });

  it("toggles trends on/off, defaulting off", () => {
    expect(DEFAULT_SLACK_CONFIG.trendsEnabled).toBe(false);
    expect(applyConfigCommand(["trends", "on"], DEFAULT_SLACK_CONFIG).config.trendsEnabled).toBe(true);
    expect(applyConfigCommand(["trends", "off"], DEFAULT_SLACK_CONFIG).config.trendsEnabled).toBe(false);
  });

  it("sets trends-geo, defaulting to US", () => {
    expect(DEFAULT_SLACK_CONFIG.trendsGeo).toBe("US");
    expect(applyConfigCommand(["trends-geo", "GB"], DEFAULT_SLACK_CONFIG).config.trendsGeo).toBe("GB");
    expect(applyConfigCommand(["trends-geo", ""], DEFAULT_SLACK_CONFIG).config.trendsGeo).toBe("US");
  });
});
