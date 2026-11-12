"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { saveUserSettings } from "@/lib/user-settings";

export type SaveState = { ok?: boolean; errors?: Record<string, string> };

export async function saveDigestSettings(_prev: SaveState, form: FormData): Promise<SaveState> {
  const user = await requireUser();
  const res = await saveUserSettings(user.id, {
    digestEmail: String(form.get("digestEmail") ?? ""),
    digestEnabled: form.get("digestEnabled") === "on",
  });
  if (!res.ok) return { errors: res.errors };
  revalidatePath("/settings");
  return { ok: true };
}
