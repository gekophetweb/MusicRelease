import { z } from "zod";
import { updateAdminSettings } from "@/install/steps";
import { adminFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

const Body = z.object({ section: z.enum(["site", "music", "mail", "schedule"]), value: z.unknown() });

export async function PUT(req: Request) {
  if (!(await adminFromRequest(req))) return new Response("Not found", { status: 404 });
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, errors: { form: "Unknown settings section" } }, { status: 422 });
  const res = await updateAdminSettings(body.data.section, body.data.value);
  return Response.json(res, { status: res.ok ? 200 : 422 });
}
