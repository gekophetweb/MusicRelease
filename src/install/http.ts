import { INSTALL_COOKIE, readCookie, verifyInstallSession } from "@/install/steps";

export function clientIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

/** Public origin as seen by the browser (Cloudflare sets x-forwarded-proto / -host). */
export function detectOrigin(req: Request): string {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto")?.split(",")[0] ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

/**
 * Redirect with a relative Location header. Behind the Cloudflare tunnel req.url holds the server's
 * internal address (e.g. 0.0.0.0:3000), so absolute URLs built from it send the browser to the wrong host;
 * a relative path is resolved by the browser against the address it is actually on.
 */
export function redirectTo(path: string, status = 303, headers: Record<string, string> = {}): Response {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error(`redirectTo expects a same-site path, got ${path}`);
  return new Response(null, { status, headers: { ...headers, location: path } });
}

export const installSessionFrom = (req: Request) => readCookie(req.headers.get("cookie"), INSTALL_COOKIE);

export async function hasInstallSession(req: Request): Promise<boolean> {
  return verifyInstallSession(installSessionFrom(req));
}

export function installCookie(session: string, req: Request): string {
  const secure = detectOrigin(req).startsWith("https://") ? "; Secure" : "";
  // Lax (not Strict): the cookie must survive the redirect back from Spotify/TIDAL in the last step.
  return `${INSTALL_COOKIE}=${encodeURIComponent(session)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200${secure}`;
}

export const clearInstallCookie = `${INSTALL_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
