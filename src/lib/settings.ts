import { prisma } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import type { MailSettings } from "@/mail/types";

export interface SiteSettings {
  publicUrl: string;
  siteName: string;
  allowSignups: boolean;
}
export interface OAuthAppSettings {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
}
export interface ScheduleSettings {
  syncCron: string;
  digestCron: string;
  timezone: string;
}
export interface InstallState {
  status: "pending" | "complete";
  completedStep: number;
  completedAt?: string;
  /** Set when the admin chose "set up mail later" in the installer. */
  mailSkipped?: boolean;
}
/** Installer internals: the setup token and the hashed installer session. */
export interface InstallSecrets {
  setupToken?: string;
  sessionHash?: string;
  sessionExpiresAt?: string;
  /** sha256 of the mail settings that last passed "Send test email" */
  mailTestedHash?: string;
}

export interface SettingsMap {
  site: SiteSettings;
  spotify: OAuthAppSettings;
  tidal: OAuthAppSettings;
  mail: MailSettings;
  schedule: ScheduleSettings;
  install: InstallState;
  installSecrets: InstallSecrets;
}
export type SettingKey = keyof SettingsMap;

export const SECRET_KEYS: SettingKey[] = ["spotify", "tidal", "mail", "installSecrets"];

export const DEFAULT_SCHEDULE: ScheduleSettings = {
  syncCron: "0 6 * * *",
  digestCron: "0 18 * * 5",
  timezone: process.env.TZ || "Europe/Amsterdam",
};

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingsMap[K] | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  if (!row) return null;
  const json = row.encrypted ? decrypt(row.value) : row.value;
  return JSON.parse(json) as SettingsMap[K];
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingsMap[K]): Promise<void> {
  const encrypted = SECRET_KEYS.includes(key);
  const json = JSON.stringify(value);
  const stored = encrypted ? encrypt(json) : json;
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value: stored, encrypted },
    update: { value: stored, encrypted },
  });
}

/** Changes whenever any setting is written; used to rebuild cached config (auth, scheduler). */
export async function getSettingsVersion(): Promise<string> {
  const agg = await prisma.appSetting.aggregate({ _max: { updatedAt: true }, _count: true });
  return `${agg._count}:${agg._max.updatedAt?.toISOString() ?? "none"}`;
}

export async function isInstalled(): Promise<boolean> {
  return (await getSetting("install"))?.status === "complete";
}

export const SECRET_MASK = "••••••";
const SECRET_FIELDS = new Set(["clientSecret", "pass", "apiKey", "apiToken", "setupToken", "sessionHash"]);

/** Replaces secret fields with a mask so settings can be sent to the browser. */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELDS.has(k) && typeof v === "string" && v !== "" ? SECRET_MASK : redactSecrets(v);
    }
    return out as T;
  }
  return value;
}
