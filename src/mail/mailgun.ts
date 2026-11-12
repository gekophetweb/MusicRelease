import { MailError } from "@/mail/errors";
import type { MailAddress, MailMessage, MailSettings, MailTransport } from "@/mail/types";

type MailgunSettings = Extract<MailSettings, { provider: "mailgun" }>;

const BASE_URL = { us: "https://api.mailgun.net", eu: "https://api.eu.mailgun.net" } as const;

const formatAddress = (a: MailAddress) => (a.name ? `${a.name} <${a.email}>` : a.email);

async function readMessage(res: Response): Promise<string> {
  const text = await res.text();
  try {
    return (JSON.parse(text) as { message?: string }).message ?? text;
  } catch {
    return text;
  }
}

export function createMailgunTransport(s: MailgunSettings): MailTransport {
  const base = BASE_URL[s.region];
  const auth = `Basic ${Buffer.from(`api:${s.apiKey}`).toString("base64")}`;

  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, { ...init, headers: { authorization: auth, ...init.headers } });
    } catch (err) {
      throw new MailError("mailgun", `Could not reach Mailgun: ${(err as Error).message}`);
    }
    if (res.status === 401 || res.status === 403) {
      throw new MailError("mailgun", "Mailgun API key was rejected", { status: res.status });
    }
    return res;
  }

  return {
    async send(msg: MailMessage) {
      const form = new FormData();
      form.set("from", formatAddress(s.from));
      form.set("to", formatAddress(msg.to));
      form.set("subject", msg.subject);
      form.set("html", msg.html);
      form.set("text", msg.text);
      for (const [k, v] of Object.entries(msg.headers ?? {})) form.set(`h:${k}`, v);
      const res = await call(`/v3/${encodeURIComponent(s.domain)}/messages`, { method: "POST", body: form });
      if (!res.ok) {
        const detail = await readMessage(res);
        throw new MailError("mailgun", `Mailgun rejected the email: ${detail}`, { status: res.status, detail });
      }
      const body = (await res.json()) as { id?: string };
      return { id: body.id };
    },
    async verify() {
      const res = await call(`/v4/domains/${encodeURIComponent(s.domain)}`);
      if (res.status === 404) {
        throw new MailError("mailgun", `Mailgun domain ${s.domain} was not found in this account/region`, { status: 404 });
      }
      if (!res.ok) {
        const detail = await readMessage(res);
        throw new MailError("mailgun", `Mailgun error: ${detail}`, { status: res.status, detail });
      }
      const body = (await res.json()) as { domain?: { state?: string } };
      if (body.domain?.state !== "active") {
        throw new MailError("mailgun", `Mailgun domain ${s.domain} is not verified yet`, { detail: body.domain?.state });
      }
    },
  };
}
