import { clientIp, installCookie } from "@/install/http";
import { startInstallSession } from "@/install/steps";

export const dynamic = "force-dynamic";

const MESSAGES = {
  401: "That setup token is not correct. Copy it from the app log: docker compose logs app",
  404: "Setup is already finished.",
  429: "Too many wrong tokens. Wait 15 minutes and try again.",
} as const;

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const res = await startInstallSession(token, clientIp(req));
  if (!res.ok) return Response.json({ ok: false, errors: { token: MESSAGES[res.status] } }, { status: res.status });
  return Response.json({ ok: true }, { headers: { "set-cookie": installCookie(res.session, req) } });
}
