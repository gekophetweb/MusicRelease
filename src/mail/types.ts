export interface MailAddress {
  email: string;
  name?: string;
}

export interface MailMessage {
  to: MailAddress;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export type MailSettings =
  | {
      provider: "smtp";
      from: MailAddress;
      host: string;
      port: number;
      security: "tls" | "starttls" | "none";
      user?: string;
      pass?: string;
    }
  | { provider: "mailgun"; from: MailAddress; domain: string; apiKey: string; region: "us" | "eu" }
  | { provider: "sender"; from: MailAddress; apiToken: string };

export type MailProviderName = MailSettings["provider"];
