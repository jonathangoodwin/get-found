import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleInterval } from "../../src/slack/schedule.js";

function at(iso: string): () => Date {
  return () => new Date(iso);
}

describe("scheduleInterval", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("fires immediately when it has never run before", async () => {
    const task = vi.fn();
    const schedule = scheduleInterval(task, {
      getState: () => ({ enabled: true, intervalDays: 7, lastRunAt: null }),
      now: at("2026-08-01T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does not fire before the interval has elapsed", async () => {
    const task = vi.fn();
    const schedule = scheduleInterval(task, {
      getState: () => ({ enabled: true, intervalDays: 7, lastRunAt: "2026-08-01T00:00:00.000Z" }),
      now: at("2026-08-03T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();
  });

  it("fires once the interval has elapsed", async () => {
    const task = vi.fn();
    const schedule = scheduleInterval(task, {
      getState: () => ({ enabled: true, intervalDays: 7, lastRunAt: "2026-08-01T00:00:00.000Z" }),
      now: at("2026-08-09T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("skips the check entirely when disabled", async () => {
    const task = vi.fn();
    const schedule = scheduleInterval(task, {
      getState: () => ({ enabled: false, intervalDays: 7, lastRunAt: null }),
      now: at("2026-08-01T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();
  });

  it("skips the check when getState returns null", async () => {
    const task = vi.fn();
    const schedule = scheduleInterval(task, {
      getState: () => null,
      now: at("2026-08-01T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();
  });

  it("does not rely on the task to update lastRunAt itself between checks (state is read fresh each time)", async () => {
    const task = vi.fn();
    let lastRunAt: string | null = "2026-08-01T00:00:00.000Z";
    const schedule = scheduleInterval(task, {
      getState: () => ({ enabled: true, intervalDays: 7, lastRunAt }),
      now: at("2026-08-09T00:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);

    lastRunAt = "2026-08-09T00:00:00.000Z";
    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
