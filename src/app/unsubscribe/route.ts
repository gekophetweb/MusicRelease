import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f5f8;color:#241631;margin:0;padding:64px 16px}main{max-width:32rem;margin:0 auto}h1{font-size:1.75rem;margin:0 0 .5rem}p{color:#6b5e78;line-height:1.5}a{color:#4a2160}
@media (prefers-color-scheme:dark){body{background:#160e1c;color:#f3eef6}p{color:#b3a5bf}a{color:#c9a2e0}}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

const escapeAttr = (s: string) => s.replace(/[&"<>]/g, (c) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[c]!);

/**
 * GET only shows a confirm button: mail security scanners open links in emails, which must not unsubscribe anyone.
 * The button (and mail clients' RFC 8058 one-click) POST to the same URL.
 */
export async function GET(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const found = token ? await prisma.userSettings.findUnique({ where: { unsubscribeToken: token }, select: { userId: true } }) : null;
  if (!found) return page("Link not recognised", "This unsubscribe link is not valid. You can turn the weekly email off under Settings.", 404);
  return page(
    "Stop the weekly email?",
    `You will no longer get the weekly list of new releases. You can turn it back on under <a href="/settings">Settings</a>.</p>
<form method="post" action="/unsubscribe?token=${escapeAttr(encodeURIComponent(token))}"><button type="submit" style="font:inherit;padding:.5rem 1rem;border-radius:6px;border:0;background:#4a2160;color:#fff;cursor:pointer">Stop the weekly email</button></form><p>`,
  );
}

export async function POST(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const res = token ? await prisma.userSettings.updateMany({ where: { unsubscribeToken: token }, data: { digestEnabled: false } }) : { count: 0 };
  if (res.count === 0) return page("Link not recognised", "This unsubscribe link is not valid. You can turn the weekly email off under Settings.", 404);
  return page(
    "Unsubscribed",
    'You will not get the weekly email any more. You can turn it back on under <a href="/settings">Settings</a>.',
  );
}
