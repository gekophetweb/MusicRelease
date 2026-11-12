/**
 * Background worker: the daily release sync and the weekly email digest.
 * Runs in its own container (same image as the app): node dist/worker.mjs
 */
import cron from "node-cron";
import { prisma } from "@/lib/db";
import { getSetting, getSettingsVersion, isInstalled } from "@/lib/settings";
import { sendWeeklyDigests } from "@/digest/send";
import { syncAll } from "@/releases/sync";
import { startScheduler } from "@/worker/scheduler";

async function main() {
  console.log("[worker] starting");
  const scheduler = await startScheduler({
    cron,
    isInstalled,
    getSchedule: () => getSetting("schedule"),
    getVersion: getSettingsVersion,
    runSync: () => syncAll(),
    runDigest: () => sendWeeklyDigests(new Date()),
    pollMs: 30_000,
    runSyncOnStart: process.env.RUN_SYNC_ON_START === "true",
  });

  // Keep the process alive (the poll timer is unref'd so tests can exit).
  const keepAlive = setInterval(() => {}, 1 << 30);

  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received, stopping`);
    scheduler.stop();
    clearInterval(keepAlive);
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] failed to start", err);
  process.exit(1);
});
