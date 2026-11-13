import { clearInstallCookie, hasInstallSession, redirectTo } from "@/install/http";
import { completeInstall } from "@/install/steps";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** OAuth callbackURL of the installer's last step: the signed-in user becomes admin and setup is locked. */
export async function GET(req: Request) {
  if (!(await hasInstallSession(req))) return redirectTo("/install");
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  if (!session) return redirectTo("/install?error=signin");

  await completeInstall(session.user.id);
  return redirectTo("/releases?welcome=1", 303, { "set-cookie": clearInstallCookie });
}
