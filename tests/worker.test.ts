import cron from "node-cron";
import { startScheduler, type SchedulerDeps } from "@/worker/scheduler";
import type { ScheduleSettings } from "@/lib/settings";

function fakeCron() {
  const tasks: { expr: string; tz?: string; name?: string; fn: () => unknown; stopped: boolean }[] = [];
  return {
    tasks,
    active: () => tasks.filter((t) => !t.stopped),
    api: {
      validate: (e: string) => cron.validate(e),
      schedule: (expr: string, fn: () => unknown, opts?: { timezone?: string; name?: string }) => {
        const t = { expr, tz: opts?.timezone, name: opts?.name, fn, stopped: false };
        tasks.push(t);
        return { stop: () => void (t.stopped = true) };
      },
    },
  };
}

function setup(state: { installed: boolean; schedule: ScheduleSettings | null; version: string }) {
  const c = fakeCron();
  const calls: string[] = [];
  const deps: SchedulerDeps = {
    cron: c.api,
    isInstalled: async () => state.installed,
    getSchedule: async () => state.schedule,
    getVersion: async () => state.version,
    runSync: async () => void calls.push("sync"),
    runDigest: async () => void calls.push("digest"),
    pollMs: 1_000_000,
    log: () => {},
  };
  return { c, calls, deps };
}

test("registers nothing before install", async () => {
  const { c, deps } = setup({ installed: false, schedule: null, version: "1" });
  const s = await startScheduler(deps);
  expect(c.tasks).toHaveLength(0);
  s.stop();
});

test("registers both jobs with defaults after install", async () => {
  const state = { installed: false, schedule: null, version: "1" };
  const { c, deps, calls } = setup(state);
  const s = await startScheduler(deps);
  state.installed = true;
  await s.refresh();
  expect(c.active().map((t) => [t.name, t.expr, t.tz])).toEqual([
    ["daily-sync", "0 6 * * *", "Europe/Amsterdam"],
    ["weekly-digest", "0 18 * * 5", "Europe/Amsterdam"],
  ]);
  await c.active()[0].fn();
  await c.active()[1].fn();
  expect(calls).toEqual(["sync", "digest"]);
  s.stop();
});

test("re-registers when the schedule setting changes", async () => {
  const state = { installed: true, schedule: { syncCron: "0 6 * * *", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" } as ScheduleSettings, version: "1" };
  const { c, deps } = setup(state);
  const s = await startScheduler(deps);
  state.schedule = { syncCron: "30 4 * * *", digestCron: "0 9 * * 1", timezone: "UTC" };
  state.version = "2";
  await s.refresh();
  expect(c.tasks.filter((t) => t.stopped)).toHaveLength(2);
  expect(c.active().map((t) => [t.expr, t.tz])).toEqual([
    ["30 4 * * *", "UTC"],
    ["0 9 * * 1", "UTC"],
  ]);
  s.stop();
  expect(c.active()).toHaveLength(0);
});

test("an unchanged settings version does not re-register", async () => {
  const state = { installed: true, schedule: null, version: "1" };
  const { c, deps } = setup(state);
  const s = await startScheduler(deps);
  await s.refresh();
  expect(c.tasks).toHaveLength(2);
  s.stop();
});

test("skips an invalid stored cron and keeps the previous jobs", async () => {
  const state = { installed: true, schedule: null as ScheduleSettings | null, version: "1" };
  const logs: string[] = [];
  const { c, deps } = setup(state);
  const s = await startScheduler({ ...deps, log: (m) => logs.push(m) });
  state.schedule = { syncCron: "every morning", digestCron: "0 18 * * 5", timezone: "Europe/Amsterdam" };
  state.version = "2";
  await s.refresh();
  expect(c.active().map((t) => t.expr)).toEqual(["0 6 * * *", "0 18 * * 5"]);
  expect(logs.some((l) => /invalid/i.test(l))).toBe(true);
  s.stop();
});

test("runs one sync at start when RUN_SYNC_ON_START is set", async () => {
  const { deps, calls } = setup({ installed: true, schedule: null, version: "1" });
  const s = await startScheduler({ ...deps, runSyncOnStart: true });
  await vi.waitFor(() => expect(calls).toEqual(["sync"]));
  s.stop();
});

test("a failing job is logged, not thrown", async () => {
  const { c, deps } = setup({ installed: true, schedule: null, version: "1" });
  const logs: string[] = [];
  const s = await startScheduler({ ...deps, runSync: async () => { throw new Error("boom"); }, log: (m) => logs.push(m) });
  await expect(c.active()[0].fn()).resolves.toBeUndefined();
  expect(logs.some((l) => l.includes("boom"))).toBe(true);
  s.stop();
});
