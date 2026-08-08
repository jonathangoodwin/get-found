export const RATE_LIMIT_MESSAGE = "I'm exhausted, mate. give me a rest, yeah?";
export const CONCURRENCY_MESSAGE = "I'm working on it. learn some patience already.";

export interface RunGuardOptions {
  /** Minimum time between the start of two manually-triggered runs, in ms. */
  minIntervalMs?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Blocks overlapping /run commands (concurrency) and throttles how often a
 * fresh run can be manually triggered (rate limit) — protects both spend
 * (Claude/DataForSEO) and the politeness of the sites being crawled.
 */
export class RunGuard {
  private running = false;
  private lastStartedAt: number | null = null;
  private readonly minIntervalMs: number;

  constructor(opts: RunGuardOptions = {}) {
    this.minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
  }

  /** Returns the rejection message if a new run should be blocked, or null if it's fine to proceed. */
  check(now: number = Date.now()): string | null {
    if (this.running) return CONCURRENCY_MESSAGE;
    if (this.lastStartedAt != null && now - this.lastStartedAt < this.minIntervalMs) return RATE_LIMIT_MESSAGE;
    return null;
  }

  start(now: number = Date.now()): void {
    this.running = true;
    this.lastStartedAt = now;
  }

  finish(): void {
    this.running = false;
  }
}
