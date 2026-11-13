import nodemailer from "nodemailer";
import { MailError } from "@/mail/errors";
import type { MailAddress, MailMessage, MailSettings, MailTransport } from "@/mail/types";

type SmtpSettings = Extract<MailSettings, { provider: "smtp" }>;

const toAddress = (a: MailAddress) => ({ address: a.email, name: a.name ?? "" });

function wrap(err: unknown): MailError {
  const e = err as { code?: string; responseCode?: number; message?: string };
  if (e.code === "EAUTH") {
    return new MailError("smtp", "SMTP login was rejected — check the username and password", { detail: e.message });
  }
  if (e.code === "ECONNECTION" || e.code === "ETIMEDOUT" || e.code === "ESOCKET" || e.code === "EDNS") {
    return new MailError("smtp", `Could not connect to the SMTP server: ${e.message}`, { detail: e.code });
  }
  return new MailError("smtp", `SMTP error: ${e.message ?? String(err)}`, { status: e.responseCode });
}

export function createSmtpTransport(s: SmtpSettings): MailTransport {
  const transporter = nodemailer.createTransport({
    host: s.host,
    port: s.port,
    secure: s.security === "tls",
    requireTLS: s.security === "starttls",
    ...(s.user ? { auth: { user: s.user, pass: s.pass ?? "" } } : {}),
    connectionTimeout: 15_000,
  });

  return {
    async send(msg: MailMessage) {
      try {
        const info = await transporter.sendMail({
          from: toAddress(s.from),
          to: toAddress(msg.to),
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers: msg.headers,
        });
        return { id: info.messageId };
      } catch (err) {
        throw wrap(err);
      }
    },
    async verify() {
      try {
        await transporter.verify();
      } catch (err) {
        throw wrap(err);
      }
    },
  };
}
