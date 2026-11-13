"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { addReply, createSuggestion, deleteSuggestion } from "@/suggestions/suggestions";

/** On error the submitted values come back, so the form can show them again (React resets the form after actions). */
export type SuggestionState = { ok?: boolean; error?: string; kind?: string; message?: string; attempt?: number };
export type ReplyState = { error?: string; message?: string; attempt?: number };

export async function sendSuggestion(prev: SuggestionState, form: FormData): Promise<SuggestionState> {
  const user = await requireUser();
  const kind = String(form.get("kind") ?? "");
  const message = String(form.get("message") ?? "");
  // Mail to the admins runs after the response: a slow mail provider must not keep the user waiting.
  const res = await createSuggestion(user.id, { kind, message, page: form.get("page") }, new Date(), (task) => after(task));
  if (!res.ok) return { error: res.error, kind, message, attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath("/suggestions");
  return { ok: true };
}

/** Reply by the sender or an admin; addReply checks who may reply. */
export async function sendReply(prev: ReplyState, form: FormData): Promise<ReplyState> {
  const user = await requireUser();
  const id = String(form.get("id") ?? "");
  const message = String(form.get("message") ?? "");
  const res = await addReply(id, user, message, new Date(), (task) => after(task));
  if (!res.ok) return { error: res.error, message, attempt: (prev.attempt ?? 0) + 1 };
  revalidatePath(`/suggestions/${id}`);
  revalidatePath(`/admin/suggestions/${id}`);
  return { attempt: (prev.attempt ?? 0) + 1 };
}

export async function removeSuggestion(form: FormData): Promise<void> {
  const user = await requireUser();
  await deleteSuggestion(String(form.get("id") ?? ""), user);
  revalidatePath("/suggestions");
  redirect("/suggestions?deleted=1");
}
