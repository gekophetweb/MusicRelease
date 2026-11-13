import { listUsers, type AdminUserRow } from "@/admin/users";
import { requireAdmin } from "@/lib/session";
import { getSignInMethods } from "@/lib/signin";
import { EmailForm } from "./EmailForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Users · MusicReleases" };

const SERVICE = { spotify: "Spotify", tidal: "TIDAL" } as const;

function UserRow({ u, emailCodes }: { u: AdminUserRow; emailCodes: boolean }) {
  return (
    <li className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-[1fr_1.4fr] sm:items-center">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate font-semibold">
          {u.name || "Unnamed"} {u.role === "admin" && <span className="ml-1 text-xs font-normal text-muted">admin</span>}
        </p>
        <p className="text-xs text-muted">
          {u.services.length ? u.services.map((s) => SERVICE[s]).join(" · ") : "No music service connected"} · joined{" "}
          <time dateTime={u.createdAt.toISOString()}>{u.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</time>
        </p>
      </div>
      <EmailForm userId={u.id} email={u.email} name={u.name} emailCodes={emailCodes} />
    </li>
  );
}

export default async function AdminUsersPage() {
  await requireAdmin();
  const [users, methods] = await Promise.all([listUsers(), getSignInMethods()]);
  const noEmail = users.filter((u) => u.email === null);
  const rest = users.filter((u) => u.email !== null);
  return (
    <main className="mx-auto max-w-4xl space-y-10 px-4 py-10">
      <div className="space-y-3">
        <h1 className="font-display text-4xl font-bold tracking-tight">Users</h1>
        <p className="max-w-prose text-sm text-muted">
          People sign in with Google or a code sent to the email below. Changing an email takes effect on their next sign-in.
        </p>
      </div>
      {!methods.emailCode && (
        <p role="status" className="max-w-prose rounded-md border border-line px-4 py-3 text-sm text-muted">
          Email codes are off. An email you set here only works with Google once that person has signed in with a code at
          least once, so turn on email codes under Admin → Settings → Sign-in for people moving over from Spotify or TIDAL.
        </p>
      )}
      {noEmail.length > 0 && (
        <section aria-labelledby="no-email" className="space-y-3">
          <h2 id="no-email" className="font-display text-xl font-semibold text-danger">
            Can&apos;t sign in until you add an email
          </h2>
          <ul className="space-y-3">
            {noEmail.map((u) => (
              <UserRow key={u.id} u={u} emailCodes={methods.emailCode} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="all-users" className="space-y-3">
        <h2 id="all-users" className="font-display text-xl font-semibold">
          {noEmail.length > 0 ? "Everyone else" : "Everyone"}
        </h2>
        <ul className="space-y-3">
          {rest.map((u) => (
            <UserRow key={u.id} u={u} emailCodes={methods.emailCode} />
          ))}
        </ul>
      </section>
    </main>
  );
}
