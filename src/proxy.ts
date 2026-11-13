import { NextResponse, type NextRequest } from "next/server";
import { createInstalledCheck, gateDecision } from "@/install/gate";
import { detectOrigin } from "@/install/http";
import { isInstalled } from "@/lib/settings";

const installed = createInstalledCheck(isInstalled);

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
