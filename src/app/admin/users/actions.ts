"use server";

import { revalidatePath } from "next/cache";
import { deleteAccount, setUserEmail } from "@/admin/users";
import { requireAdmin } from "@/lib/session";

export type EmailState = { ok?: boolean; error?: string };

export async function updateUserEmail(_prev: EmailState, form: FormData): Promise<EmailState> {
  await requireAdmin();
  const res = await setUserEmail(String(form.get("userId") ?? ""), String(form.get("email") ?? ""));
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/users");
  return { ok: true };
}

export type DeleteUserState = { error?: string };

export async function deleteUser(_prev: DeleteUserState, form: FormData): Promise<DeleteUserState> {
  const admin = await requireAdmin();
  const userId = String(form.get("userId") ?? "");
  if (userId === admin.id) return { error: "Use Settings to delete your own account" };
  const res = await deleteAccount(userId);
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin/users");
  return {};
}
