"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { setSuggestionStatus } from "@/suggestions/suggestions";

export async function markSuggestion(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const status = form.get("status") === "done" ? "done" : "open";
  if (!id) return;
  await setSuggestionStatus(id, status);
  revalidatePath("/admin/suggestions");
}
