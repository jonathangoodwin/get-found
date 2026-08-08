import { describe, expect, it } from "vitest";
import { CONCURRENCY_MESSAGE, RATE_LIMIT_MESSAGE, RunGuard } from "../../src/slack/guards.js";

describe("RunGuard", () => {
  it("allows a run when idle", () => {
    const guard = new RunGuard();
    expect(guard.check(1000)).toBeNull();
  });

  it("blocks a second run while one is in flight, with the concurrency message", () => {
    const guard = new RunGuard();
    guard.start(1000);
    expect(guard.check(1001)).toBe(CONCURRENCY_MESSAGE);
  });

  it("allows a new run once the previous one finishes and the interval has passed", () => {
    const guard = new RunGuard({ minIntervalMs: 100 });
    guard.start(1000);
    guard.finish();
    expect(guard.check(1101)).toBeNull();
  });

  it("blocks a rapid re-run after finishing, with the rate-limit message", () => {
    const guard = new RunGuard({ minIntervalMs: 100 });
    guard.start(1000);
    guard.finish();
    expect(guard.check(1050)).toBe(RATE_LIMIT_MESSAGE);
  });

  it("prioritizes the concurrency message over the rate-limit message when both would apply", () => {
    const guard = new RunGuard({ minIntervalMs: 100 });
    guard.start(1000);
    // still running AND within the rate window
    expect(guard.check(1010)).toBe(CONCURRENCY_MESSAGE);
  });

  it("respects a custom minIntervalMs", () => {
    const guard = new RunGuard({ minIntervalMs: 10_000 });
    guard.start(1000);
    guard.finish();
    expect(guard.check(5000)).toBe(RATE_LIMIT_MESSAGE);
    expect(guard.check(11_001)).toBeNull();
  });
});
