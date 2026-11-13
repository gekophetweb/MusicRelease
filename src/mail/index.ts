import { z } from "zod";
import { getSetting } from "@/lib/settings";
import { MailError, MailNotConfiguredError } from "@/mail/errors";
import { createMailgunTransport } from "@/mail/mailgun";
import { createResendTransport } from "@/mail/resend";
import { createSmtpTransport } from "@/mail/smtp";
import type { MailMessage, MailSettings, MailTransport } from "@/mail/types";

export { MailError, MailNotConfiguredError };
export type { MailMessage, MailSettings, MailTransport };

const from = z.object({ email: z.email("Enter a valid from email"), name: z.string().trim().max(100).optional() });

export const MailSettingsSchema = z.discriminatedUnion("provider", [
  z.object({
    provider: z.literal("smtp"),
    from,
    host: z.string().trim().min(1, "SMTP host is required"),
    port: z.coerce.number().int().min(1).max(65535),
    security: z.enum(["tls", "starttls", "none"]),
    user: z.string().optional(),
    pass: z.string().optional(),
  }),
  z.object({
    provider: z.literal("mailgun"),
    from,
    domain: z.string().trim().min(1, "Mailgun domain is required"),
    apiKey: z.string().trim().min(1, "Mailgun API key is required"),
    region: z.enum(["us", "eu"]),
  }),
  z.object({
    provider: z.literal("resend"),
    from,
    apiKey: z.string().trim().min(1, "Resend API key is required"),
  }),
]) satisfies z.ZodType<MailSettings>;

/** Saved mail settings that are still valid (e.g. not for a provider that was removed). */
export const isMailConfigured = (s: unknown): boolean => MailSettingsSchema.safeParse(s).success;

export function createTransport(s: MailSettings): MailTransport {
  switch (s.provider) {
    case "smtp":
      return createSmtpTransport(s);
    case "mailgun":
      return createMailgunTransport(s);
    case "resend":
      return createResendTransport(s);
  }
}

export async function sendMail(msg: MailMessage): Promise<{ id?: string }> {
  const stored = await getSetting("mail");
  // Settings saved for a provider that no longer exists (e.g. the old Sender integration) count as not configured.
  const parsed = MailSettingsSchema.safeParse(stored);
  if (!parsed.success) throw new MailNotConfiguredError();
  return createTransport(parsed.data).send(msg);
}

export async function sendTestMail(s: MailSettings, to: string): Promise<void> {
  const transport = createTransport(s);
  await transport.verify();
  await transport.send({
    to: { email: to },
    subject: "MusicReleases test email",
    text: "This is a test email from MusicReleases. Your mail settings work.",
    html: "<p>This is a test email from <strong>MusicReleases</strong>. Your mail settings work. 🎵</p>",
  });
}
