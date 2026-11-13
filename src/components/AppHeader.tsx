import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";

type Current = "releases" | "artists" | "settings" | "suggestions" | "admin";

/** Path the suggestion form records as "sent from" for each page. */
const FROM: Record<Current, string> = {
  releases: "/releases",
  artists: "/artists",
  settings: "/settings",
  suggestions: "/suggestions",
  admin: "/admin/settings",
};

export function AppHeader({ siteName, isAdmin, current }: { siteName: string; isAdmin: boolean; current: Current }) {
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
          {link(current === "suggestions" ? "/suggestions" : `/suggestions?from=${encodeURIComponent(FROM[current])}`, "Suggestions", "suggestions")}
          {isAdmin && link("/admin/settings", "Admin", "admin")}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
