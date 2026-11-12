import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  DEFAULT_SCHEDULE,
  getSetting,
  isInstalled,
  redactSecrets,
  SECRET_MASK,
  setSetting,
  type OAuthAppSettings,
} from "@/lib/settings";
import { verifySetupToken } from "@/lib/setup-token";
import { MailSettingsSchema, type MailSettings } from "@/mail";
import { MailStepSchema, MusicSchema, ScheduleSchema, SiteSchema, toErrors } from "@/install/schemas";

export const INSTALL_STEPS = ["token", "site", "music", "mail", "schedule", "admin"] as const;
export type InstallStep = (typeof INSTALL_STEPS)[number];
export type SettingsSection = "site" | "music" | "mail" | "schedule";

export type StepResult = { ok: true } | { ok: false; errors: Record<string, string> };

export const INSTALL_COOKIE = "install_session";
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;

// ---------- setup token → installer session ----------

const failures = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimits(): void {
  failures.clear();
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type StartSessionResult = { ok: true; session: string } | { ok: false; status: 401 | 404 | 429 };

export async function startInstallSession(token: string, ip: string): Promise<StartSessionResult> {
  if (await isInstalled()) return { ok: false, status: 404 };
  const now = Date.now();
  const entry = failures.get(ip);
  if (entry && entry.resetAt <= now) failures.delete(ip);
  if ((failures.get(ip)?.count ?? 0) >= MAX_FAILURES) return { ok: false, status: 429 };

  if (!(await verifySetupToken(token))) {
    const e = failures.get(ip) ?? { count: 0, resetAt: now + FAILURE_WINDOW_MS };
    e.count += 1;
    failures.set(ip, e);
    return { ok: false, status: 401 };
  }

  failures.delete(ip);
  const session = randomBytes(32).toString("base64url");
  const secrets = (await getSetting("installSecrets")) ?? {};
  await setSetting("installSecrets", {
    ...secrets,
    sessionHash: sha256(session),
    sessionExpiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
  });
  return { ok: true, session };
}

export async function verifyInstallSession(session: string | undefined | null): Promise<boolean> {
  if (!session || (await isInstalled())) return false;
  const secrets = await getSetting("installSecrets");
  if (!secrets?.sessionHash || !secrets.sessionExpiresAt) return false;
  if (new Date(secrets.sessionExpiresAt).getTime() < Date.now()) return false;
  return timingSafeEqual(Buffer.from(sha256(session)), Buffer.from(secrets.sessionHash));
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

// ---------- secrets & mail test bookkeeping ----------

/** Replaces masked secret fields in `incoming` with the stored values. */
function keepMaskedSecrets<T extends object>(incoming: T, existing: object | null): T {
  if (!existing) return incoming;
  const out = { ...incoming } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (v === SECRET_MASK) out[k] = (existing as Record<string, unknown>)[k] ?? "";
  }
  return out as T;
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v)
      .sort()
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

const mailHash = (s: MailSettings) => sha256(stableStringify(s));

export async function markMailTested(s: MailSettings): Promise<void> {
  const secrets = (await getSetting("installSecrets")) ?? {};
  await setSetting("installSecrets", { ...secrets, mailTestedHash: mailHash(s) });
}

/** Merges masked secrets with the stored mail settings and validates the result. */
export async function resolveMailSettings(
  input: unknown,
): Promise<{ ok: true; settings: MailSettings } | { ok: false; errors: Record<string, string> }> {
  const existing = await getSetting("mail");
  const raw = (input && typeof input === "object" ? input : {}) as Partial<MailSettings>;
  const merged = existing && existing.provider === raw.provider ? keepMaskedSecrets(raw, existing) : raw;
  const parsed = MailSettingsSchema.safeParse(merged);
  if (!parsed.success) return { ok: false, errors: toErrors(parsed.error, "mail") };
  return { ok: true, settings: parsed.data };
}

// ---------- applying a settings section ----------

async function applySection(section: SettingsSection, input: unknown, context: "install" | "admin"): Promise<StepResult> {
  switch (section) {
    case "site": {
      const parsed = SiteSchema.safeParse(input);
      if (!parsed.success) return { ok: false, errors: toErrors(parsed.error) };
      await setSetting("site", parsed.data);
      return { ok: true };
    }
    case "music": {
      const raw = (input ?? {}) as { spotify?: OAuthAppSettings; tidal?: OAuthAppSettings };
      const [spotify, tidal] = await Promise.all([getSetting("spotify"), getSetting("tidal")]);
      const merged = {
        spotify: raw.spotify ? keepMaskedSecrets(raw.spotify, spotify) : raw.spotify,
        tidal: raw.tidal ? keepMaskedSecrets(raw.tidal, tidal) : raw.tidal,
      };
      const parsed = MusicSchema.safeParse(merged);
      if (!parsed.success) return { ok: false, errors: toErrors(parsed.error) };
      await setSetting("spotify", parsed.data.spotify);
      await setSetting("tidal", parsed.data.tidal);
      return { ok: true };
    }
    case "mail": {
      const step = MailStepSchema.safeParse(input);
      if (!step.success) return { ok: false, errors: toErrors(step.error) };
      if (step.data.skip) {
        if (context === "install") {
          const install = (await getSetting("install")) ?? { status: "pending" as const, completedStep: 0 };
          await setSetting("install", { ...install, mailSkipped: true });
        }
        return { ok: true };
      }
      const resolved = await resolveMailSettings(step.data.settings);
      if (!resolved.ok) return resolved;
      const [existing, secrets] = await Promise.all([getSetting("mail"), getSetting("installSecrets")]);
      const unchanged = existing && stableStringify(existing) === stableStringify(resolved.settings);
      if (!unchanged && secrets?.mailTestedHash !== mailHash(resolved.settings)) {
        return { ok: false, errors: { mail: "Send a test email with these settings first" } };
      }
      await setSetting("mail", resolved.settings);
      const install = await getSetting("install");
      if (install?.mailSkipped) await setSetting("install", { ...install, mailSkipped: false });
      return { ok: true };
    }
    case "schedule": {
      const parsed = ScheduleSchema.safeParse(input);
      if (!parsed.success) return { ok: false, errors: toErrors(parsed.error) };
      await setSetting("schedule", parsed.data);
      return { ok: true };
    }
  }
}

const SESSION_EXPIRED = "Your installer session expired. Enter the setup token again.";

export async function saveInstallStep(
  step: Exclude<InstallStep, "token" | "admin">,
  input: unknown,
  session: string | undefined,
): Promise<StepResult> {
  if (!(await verifyInstallSession(session))) return { ok: false, errors: { session: SESSION_EXPIRED } };
  const res = await applySection(step, input, "install");
  if (res.ok) {
    const install = (await getSetting("install")) ?? { status: "pending" as const, completedStep: 1 };
    const reached = INSTALL_STEPS.indexOf(step) + 1;
    await setSetting("install", { ...install, completedStep: Math.max(install.completedStep, reached) });
  }
  return res;
}

export async function updateAdminSettings(section: SettingsSection, input: unknown): Promise<StepResult> {
  return applySection(section, input, "admin");
}

export async function completeInstall(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });
  if (!(await getSetting("schedule"))) await setSetting("schedule", DEFAULT_SCHEDULE);
  const install = await getSetting("install");
  await setSetting("install", {
    status: "complete",
    completedStep: INSTALL_STEPS.length,
    completedAt: new Date().toISOString(),
    mailSkipped: install?.mailSkipped ?? false,
  });
  await setSetting("installSecrets", {});
}

// ---------- data for the wizard / admin forms ----------

export function redirectUris(publicUrl: string) {
  return {
    spotify: `${publicUrl}/api/auth/callback/spotify`,
    tidal: `${publicUrl}/api/auth/callback/tidal`,
  };
}

export interface EditableSettings {
  completedStep: number;
  mailSkipped: boolean;
  site: Awaited<ReturnType<typeof getSetting<"site">>>;
  spotify: OAuthAppSettings | null;
  tidal: OAuthAppSettings | null;
  mail: MailSettings | null;
  schedule: Awaited<ReturnType<typeof getSetting<"schedule">>>;
}

export async function getEditableSettings(): Promise<EditableSettings> {
  const [install, site, spotify, tidal, mail, schedule] = await Promise.all([
    getSetting("install"),
    getSetting("site"),
    getSetting("spotify"),
    getSetting("tidal"),
    getSetting("mail"),
    getSetting("schedule"),
  ]);
  return redactSecrets({
    completedStep: install?.completedStep ?? 0,
    mailSkipped: install?.mailSkipped ?? false,
    site,
    spotify,
    tidal,
    mail,
    schedule: schedule ?? DEFAULT_SCHEDULE,
  });
}
