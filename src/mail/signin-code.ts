import { sendMail } from "@/mail";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The one-time code for signing in by email (expires after 10 minutes, see emailOTP in src/lib/auth.ts). */
export async function sendSignInCode(to: string, code: string, siteName: string): Promise<void> {
  const site = escapeHtml(siteName);
  await sendMail({
    to: { email: to },
    subject: "Your MusicReleases sign-in code",
    text: `Your code for signing in to ${siteName} is: ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;color:#241631">
  <p>Your code for signing in to <strong>${site}</strong>:</p>
  <p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>
  <p style="color:#6b5e78">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p>
</div>`,
  });
}
