import { DEFAULT_SCHEDULE, type ScheduleSettings } from "@/lib/settings";

interface CronApi {
  validate(expr: string): boolean;
  schedule(expr: string, fn: () => unknown, opts?: { timezone?: string; name?: string; noOverlap?: boolean }): { stop(): unknown };
}

export interface SchedulerDeps {
  cron: CronApi;
  isInstalled: () => Promise<boolean>;
  getSchedule: () => Promise<ScheduleSettings | null>;
  getVersion: () => Promise<string>;
  runSync: () => Promise<unknown>;
  runDigest: () => Promise<unknown>;
  /** How often to check for install completion and schedule changes. */
  pollMs?: number;
  runSyncOnStart?: boolean;
  log?: (msg: string) => void;
}

export interface Scheduler {
  /** Re-reads settings and (re)registers jobs when needed; also runs on every poll. */
  refresh(): Promise<void>;
  stop(): void;
}

export async function startScheduler(deps: SchedulerDeps): Promise<Scheduler> {
  const log = deps.log ?? ((m: string) => console.log(`[worker] ${m}`));
  let tasks: { stop(): unknown }[] = [];
  let version: string | null = null;
  let ranStartSync = false;

  const job = (name: string, run: () => Promise<unknown>) => async () => {
    const started = Date.now();
    try {
      const result = await run();
      log(`${name} done in ${Math.round((Date.now() - started) / 1000)}s ${JSON.stringify(result ?? {})}`);
    } catch (err) {
      log(`${name} failed: ${(err as Error).message}`);
    }
  };

  const stopTasks = () => {
    for (const t of tasks) t.stop();
    tasks = [];
  };

  async function refresh(): Promise<void> {
    if (!(await deps.isInstalled())) return;
    const v = await deps.getVersion();
    if (v === version && tasks.length) return;
    const s = { ...DEFAULT_SCHEDULE, ...(await deps.getSchedule()) };
    const invalid = [s.syncCron, s.digestCron].filter((e) => !deps.cron.validate(e));
    if (invalid.length) {
      log(`invalid schedule ${invalid.map((e) => `"${e}"`).join(", ")}; keeping the previous jobs`);
      version = v;
      if (tasks.length) return;
      Object.assign(s, { syncCron: DEFAULT_SCHEDULE.syncCron, digestCron: DEFAULT_SCHEDULE.digestCron });
    }
    stopTasks();
    tasks = [
      deps.cron.schedule(s.syncCron, job("daily-sync", deps.runSync), { timezone: s.timezone, name: "daily-sync", noOverlap: true }),
      deps.cron.schedule(s.digestCron, job("weekly-digest", deps.runDigest), {
        timezone: s.timezone,
        name: "weekly-digest",
        noOverlap: true,
      }),
    ];
    version = v;
    log(`scheduled sync "${s.syncCron}" and digest "${s.digestCron}" (${s.timezone})`);
    if (deps.runSyncOnStart && !ranStartSync) {
      ranStartSync = true;
      void job("startup-sync", deps.runSync)();
    }
  }

  await refresh();
  const timer = setInterval(() => void refresh().catch((e) => log(`refresh failed: ${(e as Error).message}`)), deps.pollMs ?? 30_000);
  timer.unref?.();

  return {
    refresh,
    stop() {
      clearInterval(timer);
      stopTasks();
    },
  };
}
