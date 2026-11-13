"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/admin/settings", label: "Settings" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/suggestions", label: "Suggestions" },
] as const;

/** Tabs across the admin pages; the current one is highlighted and marked for screen readers. */
export function AdminTabs({ attention }: { attention: number }) {
  const path = usePathname();
  return (
    <nav aria-label="Admin sections" className="border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {TABS.map((t) => {
          const current = path === t.href || path.startsWith(`${t.href}/`);
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={current ? "page" : undefined}
                className={`inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-3 text-sm font-medium transition ${
                  current ? "border-plum text-ink" : "border-transparent text-muted hover:border-line hover:text-ink"
                }`}
              >
                {t.label}
                {t.href === "/admin/suggestions" && attention > 0 && (
                  <span className="rounded-full bg-marigold px-1.5 text-xs font-bold leading-5 text-[#241631]" aria-label={`${attention} need attention`}>
                    {attention}
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
