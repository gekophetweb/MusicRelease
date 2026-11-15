import { z } from "zod";
import { isPlaceholderEmail } from "@/lib/auth";
import { Prisma } from "@/generated/prisma/client";
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
  // A concurrent delete (two admins deleting each other, a double click) makes Postgres abort one Serializable
  // transaction; retrying then sees the new state and answers "not found" or the last-admin error.
  for (let attempt = 1; ; attempt++) {
    try {
      return await deleteAccountOnce(userId);
    } catch (err) {
      const conflict = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034";
      if (!conflict) throw err;
      if (attempt >= 3) return { ok: false, error: "Something changed at the same time. Try again." };
    }
  }
}

function deleteAccountOnce(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  return prisma.$transaction(
    async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { role: true } });
      if (!user) return { ok: false as const, error: "User not found" };
      if (user.role === "admin" && (await tx.user.count({ where: { role: "admin" } })) <= 1) {
        return { ok: false as const, error: LAST_ADMIN_ERROR };
      }
      // Only prune artists this user alone followed: other orphans may belong to a sync that is still running.
      const soleIds = (
        await tx.artist.findMany({ where: { followers: { some: { userId }, every: { userId } } }, select: { id: true } })
      ).map((a) => a.id);
      await tx.user.delete({ where: { id: userId } });
      if (soleIds.length) {
        // Releases credited only to those artists go with them; one query, however big the library.
        await tx.release.deleteMany({
          where: { artists: { some: { artistId: { in: soleIds } }, every: { artistId: { in: soleIds } } } },
        });
        await tx.artist.deleteMany({ where: { id: { in: soleIds } } });
      }
      return { ok: true as const };
    },
    // Serializable: two admins deleting each other at once must not both pass the last-admin check.
    // Large libraries take longer than the 5 s default.
    { isolationLevel: "Serializable", timeout: 30_000 },
  );
}
