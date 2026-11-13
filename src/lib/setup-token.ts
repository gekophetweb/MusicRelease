import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSetting, isInstalled, setSetting } from "@/lib/settings";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function randomToken(): string {
  const bytes = randomBytes(24);
  const chars = Array.from(bytes, (b) => BASE32[b % 32]).join("");
  return chars.match(/.{4}/g)!.join("-");
}

function normalize(token: string): string {
  return token.trim().toUpperCase();
}

/** Returns the setup token while installation is pending (creating it once), or null when installed. */
export async function ensureSetupToken(): Promise<string | null> {
  if (await isInstalled()) return null;
  if (process.env.INSTALL_TOKEN) return process.env.INSTALL_TOKEN;
  const secrets = (await getSetting("installSecrets")) ?? {};
  if (secrets.setupToken) return secrets.setupToken;
  const token = randomToken();
  await setSetting("installSecrets", { ...secrets, setupToken: token });
  return token;
}

export async function verifySetupToken(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const token = await ensureSetupToken();
  if (!token) return false;
  // Hash both sides so lengths match for the constant-time compare.
  const a = createHash("sha256").update(normalize(candidate)).digest();
  const b = createHash("sha256").update(normalize(token)).digest();
  return timingSafeEqual(a, b);
}

export function logSetupBanner(token: string, origin?: string): void {
  const url = `${origin ?? "<your public URL>"}/install`;
  console.log(
    [
      "",
      "=== MusicReleases setup ===",
      `Open ${url} and enter setup token: ${token}`,
      "===========================",
      "",
    ].join("\n"),
  );
}
