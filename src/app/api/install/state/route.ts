import { detectOrigin, hasInstallSession } from "@/install/http";
import { getEnabledProviders } from "@/lib/auth";
import { getEditableSettings, redirectUris } from "@/install/steps";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!(await hasInstallSession(req))) return Response.json({ authenticated: false });
  const settings = await getEditableSettings();
  const origin = settings.site?.publicUrl ?? detectOrigin(req);
  return Response.json({
    authenticated: true,
    detectedOrigin: detectOrigin(req),
    redirectUris: redirectUris(origin),
    enabledProviders: await getEnabledProviders(),
    ...settings,
  });
}
