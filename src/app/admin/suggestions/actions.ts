"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireAdmin } from "@/lib/session";
import { setSuggestionStatus, STATUSES, type SuggestionStatus } from "@/suggestions/suggestions";

export async function changeStatus(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("id") ?? "");
  const status = String(form.get("status") ?? "") as SuggestionStatus;
  if (!id || !STATUSES.includes(status)) return;
  await setSuggestionStatus(id, status, new Date(), (task) => after(task));
  revalidatePath("/admin/suggestions");
  revalidatePath(`/admin/suggestions/${id}`);
}
