import { z } from "zod";
import { isPlaceholderEmail } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ProviderName } from "@/providers/types";

export interface AdminUserRow {
  id: string;
  name: string;
  /** null when the account only has a placeholder address (TIDAL hid the email) */
  email: string | null;
  role: string;
  services: ProviderName[];
  createdAt: Date;
}

const SERVICES = new Set<string>(["spotify", "tidal"]);

/** Every user; accounts that can't sign in yet (placeholder email) come first. */
export async function listUsers(): Promise<AdminUserRow[]> {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true, createdAt: true, accounts: { select: { providerId: true } } },
  });
  const rows = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: isPlaceholderEmail(u.email) ? null : u.email,
    role: u.role,
    services: [...new Set(u.accounts.map((a) => a.providerId).filter((p) => SERVICES.has(p)))] as ProviderName[],
    createdAt: u.createdAt,
  }));
  return [...rows.filter((r) => r.email === null), ...rows.filter((r) => r.email !== null)];
}

/**
 * Admin sets a user's sign-in email. Stored lowercased and unverified: the user's first code sign-in proves it.
 * Also becomes the digest address when the user had none (or only a placeholder).
 */
export async function setUserEmail(userId: string, input: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const email = input.trim().toLowerCase();
  if (!z.email().safeParse(email).success) return { ok: false, error: "Enter a valid email" };
  const taken = await prisma.user.findFirst({
    where: { id: { not: userId }, email: { equals: email, mode: "insensitive" } },
    select: { id: true },
  });
  if (taken) return { ok: false, error: "Another account already uses this email" };

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { email, emailVerified: false } });
    const settings = await tx.userSettings.findUnique({ where: { userId } });
    if (!settings) {
      await tx.userSettings.create({ data: { userId, digestEmail: email } });
    } else if (!settings.digestEmail || isPlaceholderEmail(settings.digestEmail)) {
      await tx.userSettings.update({ where: { userId }, data: { digestEmail: email } });
    }
  });
  return { ok: true };
}
