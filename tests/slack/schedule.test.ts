import { afterEach, describe, expect, it, vi } from "vitest";
import { scheduleDaily } from "../../src/slack/schedule.js";

function at(iso: string): () => Date {
  return () => new Date(iso);
}

describe("scheduleDaily", () => {
  let stop: (() => void) | null = null;

  afterEach(() => {
    stop?.();
    stop = null;
  });

  it("fires the task at the scheduled minute", async () => {
    const task = vi.fn();
    const schedule = scheduleDaily(task, {
      getSchedule: () => ({ hourUtc: 13, minuteUtc: 0 }),
      now: at("2026-08-01T13:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("does not fire outside the scheduled minute", async () => {
    const task = vi.fn();
    const schedule = scheduleDaily(task, {
      getSchedule: () => ({ hourUtc: 13, minuteUtc: 0 }),
      now: at("2026-08-01T13:05:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();
  });

  it("does not fire twice on the same day even if checked repeatedly during the scheduled minute", async () => {
    const task = vi.fn();
    const schedule = scheduleDaily(task, {
      getSchedule: () => ({ hourUtc: 13, minuteUtc: 0 }),
      now: at("2026-08-01T13:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    await schedule.checkNow();
    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("fires again on a subsequent day at the scheduled minute", async () => {
    const task = vi.fn();
    let current = "2026-08-01T13:00:00.000Z";
    const schedule = scheduleDaily(task, {
      getSchedule: () => ({ hourUtc: 13, minuteUtc: 0 }),
      now: () => new Date(current),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    current = "2026-08-02T13:00:00.000Z";
    await schedule.checkNow();

    expect(task).toHaveBeenCalledTimes(2);
  });

  it("skips the check entirely when getSchedule returns null (e.g. daily report disabled)", async () => {
    const task = vi.fn();
    const schedule = scheduleDaily(task, {
      getSchedule: () => null,
      now: at("2026-08-01T13:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();
  });

  it("reads getSchedule fresh on every check, picking up config changes without a restart", async () => {
    const task = vi.fn();
    let hourUtc = 13;
    const schedule = scheduleDaily(task, {
      getSchedule: () => ({ hourUtc, minuteUtc: 0 }),
      now: at("2026-08-01T14:00:00.000Z"),
      checkIntervalMs: 999_999,
    });
    stop = schedule.stop;

    await schedule.checkNow();
    expect(task).not.toHaveBeenCalled();

    hourUtc = 14;
    await schedule.checkNow();
    expect(task).toHaveBeenCalledTimes(1);
  });
});
