export type GateDecision = "next" | "redirect:/install" | "notfound" | "unavailable";

const isUnder = (path: string, prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

const isInstaller = (path: string) => isUnder(path, "/install") || isUnder(path, "/api/install");

const ALWAYS_OPEN = ["/api/health", "/_next", "/favicon.ico", "/robots.txt"];

/** Decides what the proxy does with a request, based on whether installation is complete. */
export function gateDecision(path: string, installed: boolean): GateDecision {
  if (ALWAYS_OPEN.some((p) => isUnder(path, p))) return "next";
  if (installed) return isInstaller(path) ? "notfound" : "next";
  if (isInstaller(path) || isUnder(path, "/api/auth")) return "next";
  if (isUnder(path, "/api")) return "unavailable";
  // Static files from /public (e.g. /logo.svg) stay reachable.
  if (/\.[a-z0-9]{2,5}$/i.test(path)) return "next";
  return "redirect:/install";
}

/**
 * "Is setup complete?" for the proxy. Once installed the app stays installed, so `true` is cached for good;
 * `false` is never cached, or the redirect right after the last setup step would be sent back to /install.
 */
export function createInstalledCheck(isInstalled: () => Promise<boolean>): () => Promise<boolean> {
  let installed = false;
  return async () => {
    if (installed) return true;
    installed = await isInstalled().catch(() => false);
    return installed;
  };
}
