import Link from "next/link";
import { SignOutButton } from "@/components/SignOutButton";
import { countAdminAttention, countUnreadForUser } from "@/suggestions/suggestions";

type Current = "releases" | "artists" | "settings" | "suggestions" | "admin";

/** Path the suggestion form records as "sent from" for each page. */
const FROM: Record<Current, string> = {
  releases: "/releases",
  artists: "/artists",
  settings: "/settings",
  suggestions: "/suggestions",
  admin: "/admin/settings",
};

export async function AppHeader({
  siteName,
  isAdmin,
  userId,
  current,
  adminAttention,
}: {
  siteName: string;
  isAdmin: boolean;
  /** Shows a badge on Suggestions when the admin replied or changed a status the user hasn't seen. */
  userId?: string;
  current: Current;
  /** Already counted by the caller (admin pages), to avoid a second query. */
  adminAttention?: number;
}) {
  const [openSuggestions, unread] = await Promise.all([
    !isAdmin ? Promise.resolve(0) : adminAttention !== undefined ? Promise.resolve(adminAttention) : countAdminAttention(),
    userId ? countUnreadForUser(userId) : Promise.resolve(0),
  ]);
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
          <span className="inline-flex items-center gap-1.5">
            {link(current === "suggestions" ? "/suggestions" : `/suggestions?from=${encodeURIComponent(FROM[current])}`, "Suggestions", "suggestions")}
            {unread > 0 && (
              <span className="rounded-full bg-marigold px-1.5 text-xs font-bold leading-5 text-[#241631]" aria-label={`${unread} new repl${unread === 1 ? "y" : "ies"}`}>
                {unread}
              </span>
            )}
          </span>
          {isAdmin && (
            <span className="inline-flex items-center gap-1.5">
              {link("/admin/settings", "Admin", "admin")}
              {openSuggestions > 0 && (
                <Link
                  href="/admin/suggestions"
                  className="rounded-full bg-marigold px-1.5 text-xs font-bold leading-5 text-[#241631]"
                  aria-label={`${openSuggestions} open suggestion${openSuggestions === 1 ? "" : "s"}`}
                >
                  {openSuggestions}
                </Link>
              )}
            </span>
          )}
          <SignOutButton />
        </nav>
      </div>
    </header>
  );
}
