import { createElement } from "react";
import { render } from "@react-email/components";
import { isPlaceholderEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DEFAULT_SCHEDULE, getSetting } from "@/lib/settings";
import type { MailMessage } from "@/mail/types";
import { formatReleaseDate } from "@/releases/normalize";
import { getReleaseViews, type ReleaseView } from "@/releases/queries";
import { WeeklyDigestEmail } from "@/digest/WeeklyDigestEmail";

export interface WeeklyDigest {
  userId: string;
  to: string;
  toName?: string;
  weekStart: Date;
  weekEnd: Date;
  albums: ReleaseView[];
  singles: ReleaseView[];
  unsubscribeUrl: string;
  siteName: string;
  siteUrl: string;
}

const DAY = 24 * 60 * 60 * 1000;

/** Today's calendar date in `timeZone`, as a UTC-midnight Date (release dates are stored that way). */
function todayIn(timeZone: string, now: Date): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return new Date(`${ymd}T00:00:00Z`);
}

/** The past 7 calendar days (today and the 6 before), day-precision releases only. Null when there is nothing to send. */
export async function buildWeeklyDigest(userId: string, now: Date): Promise<WeeklyDigest | null> {
  const [settings, user, site, schedule] = await Promise.all([
    prisma.userSettings.findUnique({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { name: true } }),
    getSetting("site"),
    getSetting("schedule"),
  ]);
  if (!settings?.digestEnabled || !settings.digestEmail || isPlaceholderEmail(settings.digestEmail) || !site) return null;

  const weekEnd = todayIn((schedule ?? DEFAULT_SCHEDULE).timezone, now);
  const weekStart = new Date(weekEnd.getTime() - 6 * DAY);
  const views = await getReleaseViews(userId, { from: weekStart, precision: "day", now: new Date(weekEnd.getTime() + DAY - 1) });
  if (views.length === 0) return null;

  return {
    userId,
    to: settings.digestEmail,
    toName: user?.name,
    weekStart,
    weekEnd,
    albums: views.filter((v) => v.type === "album"),
    singles: views.filter((v) => v.type === "single"),
    unsubscribeUrl: `${site.publicUrl}/unsubscribe?token=${encodeURIComponent(settings.unsubscribeToken)}`,
    siteName: site.siteName,
    siteUrl: site.publicUrl,
  };
}

const short = (d: Date) => formatReleaseDate(d, "day").replace(/ \d{4}$/, "");

export async function renderDigest(d: WeeklyDigest): Promise<MailMessage & { headers: Record<string, string> }> {
  const total = d.albums.length + d.singles.length;
  const range = `${short(d.weekStart)} – ${short(d.weekEnd)}`;
  const element = createElement(WeeklyDigestEmail, {
    siteName: d.siteName,
    siteUrl: d.siteUrl,
    rangeLabel: range,
    albums: d.albums,
    singles: d.singles,
    unsubscribeUrl: d.unsubscribeUrl,
  });
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return {
    to: { email: d.to, name: d.toName },
    subject: `🎵 ${total} new release${total === 1 ? "" : "s"} this week (${range})`,
    html,
    text,
    headers: { "List-Unsubscribe": `<${d.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
