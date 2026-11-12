import type { MailProviderName } from "@/mail/types";

export class MailError extends Error {
  readonly provider: MailProviderName;
  readonly status?: number;
  readonly detail?: string;

  constructor(provider: MailProviderName, message: string, opts: { status?: number; detail?: string } = {}) {
    super(message);
    this.name = "MailError";
    this.provider = provider;
    this.status = opts.status;
    this.detail = opts.detail;
  }
}

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Mail is not configured yet. An admin can set it up under Admin → Settings → Mail.");
    this.name = "MailNotConfiguredError";
  }
}
