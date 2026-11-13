"use server";

import { revalidatePath } from "next/cache";
import { setUserEmail } from "@/admin/users";
import { requireAdmin } from "@/lib/session";

export type EmailState = { ok?: boolean; error?: string };

export async function updateUserEmail(_prev: EmailState, form: FormData): Promise<EmailState> {
  await requireAdmin();
  const res = await setUserEmail(String(form.get("userId") ?? ""), String(form.get("email") ?? ""));
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/users");
  return { ok: true };
}
