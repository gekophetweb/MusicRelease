import { z } from "zod";
import { getSetting } from "@/lib/settings";
import { MailError, MailNotConfiguredError } from "@/mail/errors";
import { createMailgunTransport } from "@/mail/mailgun";
import { createSenderTransport } from "@/mail/sender";
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
    provider: z.literal("sender"),
    from,
    apiToken: z.string().trim().min(1, "Sender API token is required"),
  }),
]) satisfies z.ZodType<MailSettings>;

export function createTransport(s: MailSettings): MailTransport {
  switch (s.provider) {
    case "smtp":
      return createSmtpTransport(s);
    case "mailgun":
      return createMailgunTransport(s);
    case "sender":
      return createSenderTransport(s);
  }
}

export async function sendMail(msg: MailMessage): Promise<{ id?: string }> {
  const settings = await getSetting("mail");
  if (!settings) throw new MailNotConfiguredError();
  return createTransport(settings).send(msg);
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
