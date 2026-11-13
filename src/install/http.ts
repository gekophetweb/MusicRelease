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
