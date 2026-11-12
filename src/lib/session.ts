import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getAuth } from "@/lib/auth";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const u = session.user as typeof session.user & { role?: string };
  return { id: u.id, name: u.name, email: u.email, role: u.role ?? "user" };
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/");
  return user;
}

/** Admin-only pages and routes answer 404 to everyone else. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user || user.role !== "admin") notFound();
  return user;
}

/** For route handlers: the signed-in admin, or null. */
export async function adminFromRequest(req: Request): Promise<SessionUser | null> {
  const session = await (await getAuth()).api.getSession({ headers: req.headers });
  const u = session?.user as (NonNullable<typeof session>["user"] & { role?: string }) | undefined;
  if (!u || u.role !== "admin") return null;
  return { id: u.id, name: u.name, email: u.email, role: "admin" };
}
