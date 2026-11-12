import Link from "next/link";
import { getEditableSettings, redirectUris } from "@/install/steps";
import { isPlaceholderEmail } from "@/lib/auth";
import { requireAdmin } from "@/lib/session";
import { AdminSettings } from "./AdminSettings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin settings · MusicReleases" };

export default async function AdminSettingsPage() {
  const admin = await requireAdmin();
  const settings = await getEditableSettings();
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <Link href="/releases" className="text-sm text-muted hover:text-ink">
        Back to releases
      </Link>
      <h1 className="mb-10 mt-3 font-display text-4xl font-bold tracking-tight">Admin settings</h1>
      <AdminSettings
        settings={settings}
        redirectUris={redirectUris(settings.site?.publicUrl ?? "")}
        adminEmail={isPlaceholderEmail(admin.email) ? "" : admin.email}
      />
    </main>
  );
}
