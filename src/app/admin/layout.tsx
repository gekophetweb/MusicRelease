import type { ReactNode } from "react";
import { AdminTabs } from "@/components/admin/AdminTabs";
import { AppHeader } from "@/components/AppHeader";
import { requireAdmin } from "@/lib/session";
import { getSetting } from "@/lib/settings";
import { countAdminAttention } from "@/suggestions/suggestions";

export const dynamic = "force-dynamic";

/** Every admin page: the site header, then the admin tabs, then the page itself. */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();
  const [site, attention] = await Promise.all([getSetting("site"), countAdminAttention()]);
  return (
    <>
      <AppHeader siteName={site?.siteName ?? "MusicReleases"} isAdmin userId={admin.id} current="admin" />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Admin</p>
        <AdminTabs attention={attention} />
      </div>
      {children}
    </>
  );
}
