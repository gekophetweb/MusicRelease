import type { NormalizedRelease, ProviderName } from "@/providers/types";

export type ReleaseKind = "album" | "single";
export type DatePrecision = "day" | "month" | "year";

/** 'YYYY' | 'YYYY-MM' | 'YYYY-MM-DD' → first day of that period (UTC) plus its precision. */
export function parseReleaseDate(raw: string): { date: Date; precision: DatePrecision } | null {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(raw?.trim() ?? "");
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), m[2] ? Number(m[2]) : 1, m[3] ? Number(m[3]) : 1];
  if (y < 1000 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCMonth() !== mo - 1) return null; // e.g. 2019-02-31
  return { date, precision: m[3] ? "day" : m[2] ? "month" : "year" };
}

const TYPES: Record<ProviderName, Record<string, ReleaseKind>> = {
  // Spotify reports EPs as 'single'. Compilations and 'appears_on' are skipped.
  spotify: { album: "album", single: "single" },
  tidal: { ALBUM: "album", EP: "single", SINGLE: "single" },
};

export function classifyRelease(provider: ProviderName, rawType: string): ReleaseKind | null {
  return TYPES[provider][rawType] ?? null;
}

const EDITION = /\s*(\((explicit|clean)\)|\[(explicit|clean)\]|-\s*(single|ep))\s*$/i;

export function normalizeTitle(title: string): string {
  let t = title.trim();
  while (EDITION.test(t)) t = t.replace(EDITION, "").trim();
  return t.toLowerCase().replace(/\s+/g, " ");
}

/**
 * Collapses editions of the same release (explicit/clean, market variants, the same collaboration seen from
 * two artists) into one. Key: normalized title + kind + release date. Drops unclassifiable or undated releases.
 */
export function dedupeReleases(provider: ProviderName, rs: NormalizedRelease[]): NormalizedRelease[] {
  const byKey = new Map<string, NormalizedRelease>();
  for (const r of rs) {
    const kind = classifyRelease(provider, r.rawType);
    const date = parseReleaseDate(r.releaseDate);
    if (!kind || !date) continue;
    const key = `${normalizeTitle(r.title)}|${kind}|${r.releaseDate}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...r, artistProviderIds: [...new Set(r.artistProviderIds)] });
      continue;
    }
    const keep = (r.totalTracks ?? 0) > (prev.totalTracks ?? 0) ? r : prev;
    byKey.set(key, { ...keep, artistProviderIds: [...new Set([...prev.artistProviderIds, ...r.artistProviderIds])] });
  }
  return [...byKey.values()];
}

export function sortReleases<T extends { releaseDate: Date; title: string }>(rs: T[]): T[] {
  return [...rs].sort((a, b) => b.releaseDate.getTime() - a.releaseDate.getTime() || a.title.localeCompare(b.title));
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatReleaseDate(date: Date, precision: DatePrecision): string {
  const y = date.getUTCFullYear();
  if (precision === "year") return String(y);
  const mon = MONTHS[date.getUTCMonth()];
  if (precision === "month") return `${mon} ${y}`;
  return `${date.getUTCDate()} ${mon} ${y}`;
}
