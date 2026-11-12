import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { sendMail } from "@/mail";
import { buildWeeklyDigest, renderDigest } from "@/digest/build";

/** A user who got a digest less than this long ago is skipped (protects against double sends after a restart). */
const RESEND_GUARD_MS = 6 * 24 * 60 * 60 * 1000;

export async function sendWeeklyDigests(
  now: Date,
  deps: { send?: typeof sendMail } = {},
): Promise<{ sent: number; skipped: number; failed: number }> {
  const send = deps.send ?? sendMail;
  const recipients = await prisma.userSettings.findMany({
    where: { digestEnabled: true, digestEmail: { not: null } },
    select: { userId: true, lastDigestSentAt: true },
  });

  if (!(await getSetting("mail"))) {
    console.warn("[digest] mail is not configured; skipping the weekly email for everyone");
    return { sent: 0, skipped: recipients.length, failed: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const r of recipients) {
    if (r.lastDigestSentAt && now.getTime() - r.lastDigestSentAt.getTime() < RESEND_GUARD_MS) {
      skipped++;
      continue;
    }
    const digest = await buildWeeklyDigest(r.userId, now);
    if (!digest) {
      skipped++;
      continue;
    }
    try {
      await send(await renderDigest(digest));
      await prisma.userSettings.update({ where: { userId: r.userId }, data: { lastDigestSentAt: now } });
      sent++;
    } catch (err) {
      failed++;
      console.warn(`[digest] sending to user ${r.userId} failed: ${(err as Error).message}`);
    }
  }
  return { sent, skipped, failed };
}
