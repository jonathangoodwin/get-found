import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { GapReport } from "../types.js";

export const DEFAULT_HISTORY_DIR = ".get-found/history";

export interface HistoryStore {
  save(report: GapReport): Promise<void>;
  loadAll(ownDomain: string): Promise<GapReport[]>;
  loadLatest(ownDomain: string): Promise<GapReport | null>;
}

/**
 * Persists each run's GapReport as its own timestamped JSON file — no
 * database, just a directory a user can inspect, diff, or delete by hand.
 * Runs never overwrite each other, so history accumulates naturally.
 */
export class FileHistoryStore implements HistoryStore {
  constructor(private readonly dir: string = DEFAULT_HISTORY_DIR) {}

  async save(report: GapReport): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const filename = buildFilename(report);
    await writeFile(join(this.dir, filename), JSON.stringify(report, null, 2), "utf-8");
  }

  async loadAll(ownDomain: string): Promise<GapReport[]> {
    const prefix = `${sanitize(ownDomain)}__`;
    let filenames: string[];
    try {
      filenames = await readdir(this.dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const reports: GapReport[] = [];
    for (const filename of filenames) {
      if (!filename.startsWith(prefix) || !filename.endsWith(".json")) continue;
      const raw = await readFile(join(this.dir, filename), "utf-8");
      reports.push(JSON.parse(raw) as GapReport);
    }

    return reports.sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
  }

  async loadLatest(ownDomain: string): Promise<GapReport | null> {
    const all = await this.loadAll(ownDomain);
    return all.length > 0 ? all[all.length - 1] : null;
  }
}

function buildFilename(report: GapReport): string {
  const timestamp = report.generatedAt.replace(/[:.]/g, "-");
  return `${sanitize(report.ownDomain)}__${timestamp}.json`;
}

function sanitize(domain: string): string {
  return domain.replace(/[^a-z0-9.-]/gi, "-");
}
