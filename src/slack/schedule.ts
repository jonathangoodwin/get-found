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

export interface IntervalScheduleState {
  enabled: boolean;
  intervalDays: number;
  /** ISO timestamp of the last run, or null if it has never run. */
  lastRunAt: string | null;
}

export interface IntervalScheduleOptions {
  /** Read fresh each check — return null to skip entirely. */
  getState: () => Promise<IntervalScheduleState | null> | IntervalScheduleState | null;
  now?: () => Date;
  checkIntervalMs?: number;
}

export interface IntervalSchedule {
  stop: () => void;
  /** Runs one check immediately — exposed so tests don't need to wait on a real interval. */
  checkNow: () => Promise<void>;
}

const DEFAULT_INTERVAL_CHECK_MS = 60 * 60_000;

/**
 * Polls every `checkIntervalMs` and fires `task` once `intervalDays` have
 * passed since `lastRunAt` — a plain "every N days" cadence, as opposed to
 * scheduleDaily's "once per day at a fixed time." `task` is responsible for
 * persisting the new lastRunAt itself (it owns the config store); this
 * scheduler only decides *when* to fire, reading state fresh each check so
 * a config change (new interval, toggled off) takes effect without a
 * process restart.
 */
export function scheduleInterval(task: () => Promise<void> | void, opts: IntervalScheduleOptions): IntervalSchedule {
  const now = opts.now ?? (() => new Date());

  const checkNow = async (): Promise<void> => {
    const state = await opts.getState();
    if (!state || !state.enabled) return;

    const due =
      state.lastRunAt === null ||
      now().getTime() - new Date(state.lastRunAt).getTime() >= state.intervalDays * 24 * 60 * 60_000;

    if (due) await task();
  };

  const interval = setInterval(() => {
    checkNow().catch((err) => console.error("Interval task failed:", err));
  }, opts.checkIntervalMs ?? DEFAULT_INTERVAL_CHECK_MS);

  return { stop: () => clearInterval(interval), checkNow };
}
