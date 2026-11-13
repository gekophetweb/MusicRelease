import { AppHeader } from "@/components/AppHeader";
import { getSetting } from "@/lib/settings";
import { countAdminAttention } from "@/suggestions/suggestions";
import { AdminTabs } from "./AdminTabs";

/**
 * Site header + admin tabs. Rendered by each admin page (not the layout) so the counts are fresh on every
 * navigation, and computed after the page's own work (e.g. opening a thread marks it read first).
 */
export async function AdminChrome({ adminId }: { adminId: string }) {
  const [site, attention] = await Promise.all([
    getSetting("site"),
    countAdminAttention(),
  ]);
  return (
    <>
      <AppHeader
        siteName={site?.siteName ?? "MusicReleases"}
        isAdmin
        userId={adminId}
        current="admin"
        adminAttention={attention}
      />
      <div className="mx-auto max-w-4xl px-4 pt-8">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
          Admin
        </p>
        <AdminTabs attention={attention} />
      </div>
    </>
  );
}
