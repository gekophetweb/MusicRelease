import { z } from "zod";
import { markMailTested, resolveMailSettings } from "@/install/steps";
import { MailError, sendTestMail } from "@/mail";

const Body = z.object({ settings: z.unknown(), to: z.email("Enter the address to send the test email to") });

/** Shared by the installer and admin settings: verify + send a test email, remember the settings that passed. */
export async function handleTestMail(req: Request): Promise<Response> {
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return Response.json({ ok: false, errors: { to: body.error.issues[0].message } }, { status: 422 });
  const resolved = await resolveMailSettings(body.data.settings);
  if (!resolved.ok) return Response.json(resolved, { status: 422 });
  try {
    await sendTestMail(resolved.settings, body.data.to);
  } catch (err) {
    const message = err instanceof MailError ? err.message : `Sending failed: ${(err as Error).message}`;
    return Response.json({ ok: false, errors: { mail: message } }, { status: 422 });
  }
  await markMailTested(resolved.settings);
  return Response.json({ ok: true });
}
