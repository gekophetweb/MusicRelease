import { detectOrigin, hasInstallSession } from "@/install/http";
import { getEditableSettings, redirectUris } from "@/install/steps";
import { getSignInMethods } from "@/lib/signin";

/** What the installer wizard needs to render; only filled in for a valid installer session. */
export async function getInstallState(req: Request) {
  if (!(await hasInstallSession(req))) return { authenticated: false as const };
  const settings = await getEditableSettings();
  const origin = settings.site?.publicUrl ?? detectOrigin(req);
  return {
    authenticated: true as const,
    detectedOrigin: detectOrigin(req),
    redirectUris: redirectUris(origin),
    signInMethods: await getSignInMethods(),
    ...settings,
  };
}
