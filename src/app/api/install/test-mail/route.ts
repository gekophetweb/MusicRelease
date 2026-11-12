import { hasInstallSession } from "@/install/http";
import { handleTestMail } from "@/install/test-mail";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!(await hasInstallSession(req))) {
    return Response.json({ ok: false, errors: { session: "Your installer session expired." } }, { status: 401 });
  }
  return handleTestMail(req);
}
