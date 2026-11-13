import { MailError } from "@/mail/errors";
import type { MailMessage, MailSettings, MailTransport } from "@/mail/types";

type SenderSettings = Extract<MailSettings, { provider: "sender" }>;

/** Sender (sender.net) transactional API — https://api.sender.net/transactional-campaigns/send-transactional/ */
const BASE_URL = "https://api.sender.net/v2";

interface SenderErrorBody {
  success?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
}

function describe(body: SenderErrorBody): string {
  const fields = Object.entries(body.errors ?? {})
    .map(([field, msgs]) => `${field}: ${msgs.join(", ")}`)
    .join("; ");
  return [body.message ?? "unknown error", fields ? `(${fields})` : ""].filter(Boolean).join(" ");
}

export function createSenderTransport(s: SenderSettings): MailTransport {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${s.apiToken}`,
          accept: "application/json",
          "content-type": "application/json",
          ...init.headers,
        },
      });
    } catch (err) {
      throw new MailError("sender", `Could not reach Sender: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new MailError("sender", "Sender API token was rejected", { status: res.status });
    }
    return res;
  }

  async function readBody(res: Response): Promise<SenderErrorBody> {
    try {
      return (await res.json()) as SenderErrorBody;
    } catch {
      return { message: res.statusText };
    }
  }

  return {
    async send(msg: MailMessage) {
      const res = await call("/message/send", {
        method: "POST",
        body: JSON.stringify({
          from: { email: s.from.email, name: s.from.name || s.from.email },
          to: { email: msg.to.email, ...(msg.to.name ? { name: msg.to.name } : {}) },
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      const body = (await readBody(res)) as SenderErrorBody & { emailId?: string };
      if (!res.ok || body.success === false) {
        const detail = describe(body);
        throw new MailError("sender", `Sender rejected the email: ${detail}`, { status: res.status, detail });
      }
      return { id: body.emailId };
    },
    async verify() {
      const res = await call("/groups");
      if (!res.ok) {
        const detail = describe(await readBody(res));
        throw new MailError("sender", `Sender error: ${detail}`, { status: res.status, detail });
      }
    },
  };
}
