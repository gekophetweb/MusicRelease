"use server";

import { after } from "next/server";
import { requireUser } from "@/lib/session";
import { createSuggestion } from "@/suggestions/suggestions";

/** On error the submitted values come back, so the form can show them again (React resets the form after actions). */
export type SuggestionState = { ok?: boolean; error?: string; kind?: string; message?: string; attempt?: number };

export async function sendSuggestion(prev: SuggestionState, form: FormData): Promise<SuggestionState> {
  const user = await requireUser();
  const kind = String(form.get("kind") ?? "");
  const message = String(form.get("message") ?? "");
  // Mail to the admins runs after the response: a slow mail provider must not keep the user waiting.
  const res = await createSuggestion(user.id, { kind, message, page: form.get("page") }, new Date(), (task) => after(task));
  return res.ok ? { ok: true } : { error: res.error, kind, message, attempt: (prev.attempt ?? 0) + 1 };
}
