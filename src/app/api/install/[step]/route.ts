import { installSessionFrom } from "@/install/http";
import { saveInstallStep } from "@/install/steps";

export const dynamic = "force-dynamic";

const STEPS = ["site", "signin", "music", "mail", "schedule"] as const;
type SavableStep = (typeof STEPS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ step: string }> }) {
  const { step } = await ctx.params;
  if (!STEPS.includes(step as SavableStep)) return Response.json({ ok: false, errors: { form: "Unknown step" } }, { status: 404 });
  const input = await req.json().catch(() => null);
  const res = await saveInstallStep(step as SavableStep, input, installSessionFrom(req));
  const status = res.ok ? 200 : "session" in res.errors ? 401 : 422;
  return Response.json(res, { status });
}
