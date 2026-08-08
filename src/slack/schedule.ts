export interface ScheduleTime {
  hourUtc: number;
  minuteUtc: number;
}

export interface DailyScheduleOptions {
  /** Read fresh each check — return null to skip (e.g. daily report disabled). */
  getSchedule: () => Promise<ScheduleTime | null> | ScheduleTime | null;
  now?: () => Date;
  checkIntervalMs?: number;
}

export interface DailySchedule {
  stop: () => void;
  /** Runs one check immediately — exposed so tests don't need to wait on a real interval. */
  checkNow: () => Promise<void>;
}

const DEFAULT_CHECK_INTERVAL_MS = 60_000;

/**
 * Polls every `checkIntervalMs` and fires `task` at most once per UTC day,
 * at the hour/minute `getSchedule` currently reports — read live each check
 * so a config change takes effect without restarting the process.
 */
export function scheduleDaily(task: () => Promise<void> | void, opts: DailyScheduleOptions): DailySchedule {
  const now = opts.now ?? (() => new Date());
  let lastRunDate: string | null = null;

  const checkNow = async (): Promise<void> => {
    const schedule = await opts.getSchedule();
    if (!schedule) return;

    const current = now();
    const today = current.toISOString().slice(0, 10);
    const isScheduledMinute = current.getUTCHours() === schedule.hourUtc && current.getUTCMinutes() === schedule.minuteUtc;

    if (isScheduledMinute && lastRunDate !== today) {
      lastRunDate = today;
      await task();
    }
  };

  const interval = setInterval(() => {
    checkNow().catch((err) => console.error("Daily report task failed:", err));
  }, opts.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS);

  return { stop: () => clearInterval(interval), checkNow };
}
