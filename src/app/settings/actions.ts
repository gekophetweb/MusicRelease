"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { deleteAccount } from "@/admin/users";
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

export type DeleteState = { error?: string };

/** Deletes the signed-in person's account; their sessions go with it, so they land on the home page signed out. */
export async function deleteMyAccount(_prev: DeleteState, form: FormData): Promise<DeleteState> {
  const user = await requireUser();
  if (form.get("confirm") !== "DELETE") return { error: "Type DELETE to confirm" };
  const res = await deleteAccount(user.id);
  if (!res.ok) return { error: res.error };
  redirect("/");
}
