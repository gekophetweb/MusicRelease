import { NextResponse, type NextRequest } from "next/server";
import { gateDecision } from "@/install/gate";
import { detectOrigin } from "@/install/http";
import { isInstalled } from "@/lib/settings";

// Once installed, the app stays installed: cache that forever. While pending, re-check every 2 s.
let installedCache: { value: boolean; at: number } | null = null;

async function installed(): Promise<boolean> {
  if (installedCache?.value) return true;
  if (installedCache && Date.now() - installedCache.at < 2000) return false;
  const value = await isInstalled().catch(() => false);
  installedCache = { value, at: Date.now() };
  return value;
}

export async function proxy(req: NextRequest) {
  const decision = gateDecision(req.nextUrl.pathname, await installed());
  switch (decision) {
    case "next":
      return NextResponse.next();
    case "redirect:/install":
      // Not req.url: behind the tunnel that is the internal bind address (0.0.0.0:3000). Middleware needs an
      // absolute URL, so build it from the forwarded/Host headers, which carry the public host.
      return NextResponse.redirect(new URL("/install", detectOrigin(req)));
    case "notfound":
      return new NextResponse("Not found", { status: 404 });
    case "unavailable":
      return NextResponse.json({ error: "Setup is not finished yet" }, { status: 503 });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
