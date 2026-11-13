import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * Defence in depth only: Next can render an admin page without re-running this layout, so every admin page and
 * action checks requireAdmin itself. The header and tabs come from <AdminChrome> in each page.
 */
export default async function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  await requireAdmin();
  return <>{children}</>;
}
