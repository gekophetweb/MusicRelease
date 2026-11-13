import { MailError } from "@/mail/errors";
import type { MailAddress, MailMessage, MailSettings, MailTransport } from "@/mail/types";

type ResendSettings = Extract<MailSettings, { provider: "resend" }>;

/** Resend REST API — https://resend.com/docs/api-reference/introduction */
const BASE_URL = "https://api.resend.com";

interface ResendErrorBody {
  statusCode?: number;
  name?: string;
  message?: string;
}

/** Resend takes `Name <email>`; quote the name when it contains characters that would break that format. */
function formatAddress(a: MailAddress): string {
  if (!a.name) return a.email;
  const name = /[",<>@;:()[\]\\]/.test(a.name) ? `"${a.name.replace(/["\\]/g, "\\$&")}"` : a.name;
  return `${name} <${a.email}>`;
}

async function readBody(res: Response): Promise<ResendErrorBody> {
  try {
    return (await res.json()) as ResendErrorBody;
  } catch {
    return { message: res.statusText };
  }
}

/** Missing or invalid keys come back as 401, or as a 400 validation_error saying "API key is invalid". */
function isRejectedKey(res: Response, body: ResendErrorBody): boolean {
  if (body.name === "restricted_api_key" && res.status === 401) return false; // valid key, send-only scope
  if (res.status === 401) return true;
  return res.status === 400 && /api key/i.test(body.message ?? "");
}

export function createResendTransport(s: ResendSettings): MailTransport {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${s.apiKey}`,
          accept: "application/json",
          "content-type": "application/json",
          ...init.headers,
        },
      });
    } catch (err) {
      throw new MailError("resend", `Could not reach Resend: ${(err as Error).message}`);
    }
  }

  return {
    async send(msg: MailMessage) {
      const res = await call("/emails", {
        method: "POST",
        body: JSON.stringify({
          from: formatAddress(s.from),
          to: [formatAddress(msg.to)],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      if (!res.ok) {
        const body = await readBody(res);
        if (isRejectedKey(res, body)) throw new MailError("resend", "Resend API key was rejected", { status: res.status });
        const detail = body.message ?? body.name ?? "unknown error";
        throw new MailError("resend", `Resend rejected the email: ${detail}`, { status: res.status, detail });
      }
      const body = (await res.json()) as { id?: string };
      return { id: body.id };
    },

    async verify() {
      const res = await call("/domains");
      if (res.ok) {
        // Full-access key: also check that the from address's domain is verified in Resend.
        const body = (await res.json()) as { data?: { name: string; status: string }[] };
        const fromDomain = s.from.email.split("@").pop()!.toLowerCase();
        const domain = (body.data ?? []).find((d) => d.name.toLowerCase() === fromDomain);
        if (!domain) {
          throw new MailError("resend", `Domain ${fromDomain} has not been added to Resend`, { detail: "domain missing" });
        }
        if (domain.status !== "verified") {
          throw new MailError("resend", `Resend domain ${fromDomain} is not verified yet`, { detail: domain.status });
        }
        return;
      }
      const body = await readBody(res);
      // A sending-only key can't list domains, but it did authenticate; the test send will catch domain problems.
      if (res.status === 401 && body.name === "restricted_api_key") return;
      if (isRejectedKey(res, body)) throw new MailError("resend", "Resend API key was rejected", { status: res.status });
      const detail = body.message ?? body.name ?? "unknown error";
      throw new MailError("resend", `Resend error: ${detail}`, { status: res.status, detail });
    },
  };
}
