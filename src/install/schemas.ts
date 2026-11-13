import cron from "node-cron";
import { z } from "zod";

export const SiteSchema = z.object({
  publicUrl: z
    .url({ protocol: /^https?$/, message: "Enter the full public URL, starting with https://" })
    .transform((u) => u.replace(/\/+$/, "")),
  siteName: z.string().trim().min(1, "Give the site a name").max(60),
  allowSignups: z.boolean(),
});

const OAuthAppSchema = z.object({
  enabled: z.boolean(),
  clientId: z.string().trim(),
  clientSecret: z.string().trim(),
});

export const MusicSchema = z
  .object({ spotify: OAuthAppSchema, tidal: OAuthAppSchema })
  .superRefine((v, ctx) => {
    if (!v.spotify.enabled && !v.tidal.enabled) {
      ctx.addIssue({ code: "custom", path: ["services"], message: "Enable at least one music service" });
    }
    for (const name of ["spotify", "tidal"] as const) {
      const s = v[name];
      if (!s.enabled) continue;
      if (!s.clientId) ctx.addIssue({ code: "custom", path: [name, "clientId"], message: "Client ID is required" });
      if (!s.clientSecret) ctx.addIssue({ code: "custom", path: [name, "clientSecret"], message: "Client secret is required" });
    }
  });

/** The settings object is validated separately with MailSettingsSchema after secrets are merged. */
export const MailStepSchema = z.object({ skip: z.boolean(), settings: z.unknown().optional() });

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const cronString = (label: string) =>
  z
    .string()
    .trim()
    .refine((v) => v.split(/\s+/).length === 5 && cron.validate(v), `${label} is not a valid schedule`);

export const ScheduleSchema = z.object({
  syncCron: cronString("Daily sync"),
  digestCron: cronString("Weekly digest"),
  timezone: z.string().refine(isTimezone, "Unknown timezone"),
});

/** Zod issues → { "spotify.clientId": "Client ID is required", ... } (first message per field). */
export function toErrors(error: z.ZodError, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = [prefix, ...issue.path.map(String)].filter(Boolean).join(".") || "form";
    out[key] ??= issue.message;
  }
  return out;
}
