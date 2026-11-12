import { z } from "zod";
import { prisma } from "@/lib/db";

const Input = z.object({
  digestEmail: z.union([z.literal(""), z.email("Enter a valid email address")]),
  digestEnabled: z.boolean(),
});

export async function getUserSettings(userId: string) {
  return prisma.userSettings.upsert({ where: { userId }, create: { userId }, update: {} });
}

export async function saveUserSettings(
  userId: string,
  input: { digestEmail: string; digestEnabled: boolean },
): Promise<{ ok: true } | { ok: false; errors: Record<string, string> }> {
  const parsed = Input.safeParse({ ...input, digestEmail: input.digestEmail?.trim() ?? "" });
  if (!parsed.success) {
    return { ok: false, errors: Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])) };
  }
  const data = { digestEmail: parsed.data.digestEmail || null, digestEnabled: parsed.data.digestEnabled };
  await prisma.userSettings.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return { ok: true };
}
