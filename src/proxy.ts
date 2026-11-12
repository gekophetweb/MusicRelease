import { NextResponse, type NextRequest } from "next/server";
import { gateDecision } from "@/install/gate";
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
      return NextResponse.redirect(new URL("/install", req.url));
    case "notfound":
      return new NextResponse("Not found", { status: 404 });
    case "unavailable":
      return NextResponse.json({ error: "Setup is not finished yet" }, { status: 503 });
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
