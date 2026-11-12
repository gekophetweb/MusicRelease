import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f5f8;color:#241631;margin:0;padding:64px 16px}main{max-width:32rem;margin:0 auto}h1{font-size:1.75rem;margin:0 0 .5rem}p{color:#6b5e78;line-height:1.5}a{color:#4a2160}
@media (prefers-color-scheme:dark){body{background:#160e1c;color:#f3eef6}p{color:#b3a5bf}a{color:#c9a2e0}}</style></head>
<body><main><h1>${title}</h1><p>${body}</p></main></body></html>`;
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

async function unsubscribe(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const res = token ? await prisma.userSettings.updateMany({ where: { unsubscribeToken: token }, data: { digestEnabled: false } }) : { count: 0 };
  if (res.count === 0) return page("Link not recognised", "This unsubscribe link is not valid. You can turn the weekly email off under Settings.", 404);
  return page(
    "Unsubscribed",
    'You will not get the weekly email any more. You can turn it back on under <a href="/settings">Settings</a>.',
  );
}

export const GET = unsubscribe;
/** RFC 8058 one-click unsubscribe from the mail client. */
export const POST = unsubscribe;
