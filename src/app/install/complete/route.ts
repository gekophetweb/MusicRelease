import { clearInstallCookie, hasInstallSession } from "@/install/http";
import { completeInstall } from "@/install/steps";
import { getAuth } from "@/lib/auth";
import { onFirstSignIn } from "@/releases/first-sync";

export const dynamic = "force-dynamic";

/** OAuth callbackURL of the installer's last step: the signed-in user becomes admin and setup is locked. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!(await hasInstallSession(req))) return Response.redirect(new URL("/install", url), 303);
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  if (!session) return Response.redirect(new URL("/install?error=signin", url), 303);

  await completeInstall(session.user.id);
  onFirstSignIn(session.user.id);
  return new Response(null, {
    status: 303,
    headers: { location: new URL("/releases?welcome=1", url).toString(), "set-cookie": clearInstallCookie },
  });
}
