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

export const LAST_ADMIN_ERROR = "You're the only admin. Make someone else admin first.";

/**
 * Deletes a user and everything that belongs to them (the database cascades sessions, accounts, followed artists,
 * settings, sync runs and their suggestions; their replies elsewhere keep, author cleared). Artists nobody follows
 * anymore, and releases left without an artist, are removed too. The last admin can't be deleted.
 */
export async function deleteAccount(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!user) return { ok: false as const, error: "User not found" };
      if (user.role === "admin" && (await tx.user.count({ where: { role: "admin" } })) <= 1) {
        return { ok: false as const, error: LAST_ADMIN_ERROR };
      }
      // Only prune what this user followed: other orphans may belong to a sync that is still running.
      const followed = await tx.artist.findMany({
        where: { followers: { some: { userId } } },
        select: { id: true, releases: { select: { releaseId: true } } },
      });
      const releaseIds = followed.flatMap((a) => a.releases.map((r) => r.releaseId));
      await tx.user.delete({ where: { id: userId } });
      await tx.artist.deleteMany({ where: { id: { in: followed.map((a) => a.id) }, followers: { none: {} } } });
      await tx.release.deleteMany({ where: { id: { in: releaseIds }, artists: { none: {} } } });
      return { ok: true as const };
    },
    // Two admins deleting each other at once must not both pass the last-admin check.
    { isolationLevel: "Serializable" },
  );
}
