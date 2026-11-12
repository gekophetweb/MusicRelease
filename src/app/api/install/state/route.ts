import { getInstallState } from "@/install/state";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return Response.json(await getInstallState(req));
}
