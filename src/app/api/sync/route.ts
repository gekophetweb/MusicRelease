import { getAuth } from "@/lib/auth";
import { ReconnectRequiredError } from "@/lib/tokens";
import { syncUser } from "@/releases/sync";

export const dynamic = "force-dynamic";

/** "Sync now" for the signed-in user. */
export async function POST(req: Request) {
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  if (!session) return Response.json({ error: "Sign in first" }, { status: 401 });
  try {
    return Response.json(await syncUser(session.user.id));
  } catch (err) {
    if (err instanceof ReconnectRequiredError) {
      return Response.json({ error: `Reconnect ${err.provider === "tidal" ? "TIDAL" : "Spotify"} to keep syncing` }, { status: 409 });
    }
    console.error("[sync] manual sync failed", err);
    return Response.json({ error: "Sync failed. Try again in a few minutes." }, { status: 502 });
  }
}
