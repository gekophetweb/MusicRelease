"use server";

import { requireUser } from "@/lib/session";
import { createSuggestion } from "@/suggestions/suggestions";

export type SuggestionState = { ok?: boolean; error?: string };

export async function sendSuggestion(_prev: SuggestionState, form: FormData): Promise<SuggestionState> {
  const user = await requireUser();
  const res = await createSuggestion(user.id, { kind: form.get("kind"), message: form.get("message"), page: form.get("page") });
  return res.ok ? { ok: true } : { error: res.error };
}
