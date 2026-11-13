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
  | { provider: "resend"; from: MailAddress; apiKey: string };

export type MailProviderName = MailSettings["provider"];

export interface MailTransport {
  send(msg: MailMessage): Promise<{ id?: string }>;
  /** Checks credentials without sending; throws MailError with a readable message. */
  verify(): Promise<void>;
}
