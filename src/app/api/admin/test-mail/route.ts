import { handleTestMail } from "@/install/test-mail";
import { adminFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await adminFromRequest(req))) return new Response("Not found", { status: 404 });
  return handleTestMail(req);
}
