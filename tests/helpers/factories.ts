import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";

export async function createUser(over: { id?: string; email?: string | null; role?: string } = {}) {
  const id = over.id ?? randomUUID();
  return prisma.user.create({
    data: { id, name: `User ${id.slice(0, 4)}`, email: over.email ?? `${id}@example.com`, role: over.role ?? "user" },
  });
}

export async function createAccount(userId: string, providerId: "spotify" | "tidal", over: { needsReconnect?: boolean } = {}) {
  return prisma.account.create({
    data: {
      id: randomUUID(),
      accountId: `${providerId}-${userId}`,
      providerId,
      userId,
      accessToken: "old-token",
      refreshToken: "refresh",
      needsReconnect: over.needsReconnect ?? false,
    },
  });
}

export const spotifyOn = { enabled: true, clientId: "sp-id", clientSecret: "sp-secret" };
export const tidalOn = { enabled: true, clientId: "td-id", clientSecret: "td-secret" };
export const site = { publicUrl: "https://releases.example.com", siteName: "MusicReleases", allowSignups: false };
