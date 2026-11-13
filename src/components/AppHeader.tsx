import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

export function AppHeader({ siteName, isAdmin, current }: { siteName: string; isAdmin: boolean; current: "releases" | "artists" | "settings" | "admin" }) {
  const link = (href: string, label: string, key: typeof current) => (
    <Link
      href={href}
      aria-current={current === key ? "page" : undefined}
      className={current === key ? "font-semibold text-ink" : "text-muted hover:text-ink"}
    >
      {label}
    </Link>
  );
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-4">
        <Link href="/releases" className="font-display text-xl font-bold tracking-tight">
          {siteName}
        </Link>
        <nav className="flex items-center gap-5 text-sm">
          {link("/releases", "Releases", "releases")}
          {link("/artists", "Artists", "artists")}
          {link("/settings", "Settings", "settings")}
          {isAdmin && link("/admin/settings", "Admin", "admin")}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
