import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileHistoryStore } from "../../src/history/store.js";
import type { GapReport } from "../../src/types.js";

function report(overrides: Partial<GapReport>): GapReport {
  return {
    generatedAt: "2026-08-01T00:00:00.000Z",
    ownDomain: "ours.com",
    competitorDomains: ["comp.com"],
    opportunities: [],
    ...overrides,
  };
}

describe("FileHistoryStore", () => {
  let dir: string;
  let store: FileHistoryStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "get-found-history-"));
    store = new FileHistoryStore(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns an empty list when nothing has been saved yet", async () => {
    expect(await store.loadAll("ours.com")).toEqual([]);
    expect(await store.loadLatest("ours.com")).toBeNull();
  });

  it("round-trips a saved report", async () => {
    const saved = report({ generatedAt: "2026-08-01T00:00:00.000Z" });
    await store.save(saved);

    const all = await store.loadAll("ours.com");
    expect(all).toEqual([saved]);
  });

  it("returns the most recently generated report as latest, regardless of save order", async () => {
    const older = report({ generatedAt: "2026-08-01T00:00:00.000Z" });
    const newer = report({ generatedAt: "2026-08-05T00:00:00.000Z" });

    await store.save(newer);
    await store.save(older);

    const latest = await store.loadLatest("ours.com");
    expect(latest?.generatedAt).toBe("2026-08-05T00:00:00.000Z");
  });

  it("keeps history separate per domain", async () => {
    await store.save(report({ ownDomain: "ours.com", generatedAt: "2026-08-01T00:00:00.000Z" }));
    await store.save(report({ ownDomain: "competitor.com", generatedAt: "2026-08-01T00:00:00.000Z" }));

    expect(await store.loadAll("ours.com")).toHaveLength(1);
    expect(await store.loadAll("competitor.com")).toHaveLength(1);
    expect(await store.loadAll("unrelated.com")).toEqual([]);
  });

  it("never overwrites a previous run — each save is a distinct file", async () => {
    await store.save(report({ generatedAt: "2026-08-01T00:00:00.000Z" }));
    await store.save(report({ generatedAt: "2026-08-02T00:00:00.000Z" }));
    await store.save(report({ generatedAt: "2026-08-03T00:00:00.000Z" }));

    expect(await store.loadAll("ours.com")).toHaveLength(3);
  });
});
