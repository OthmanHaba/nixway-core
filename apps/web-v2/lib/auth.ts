/**
 * Server-side auth helpers for RSC. Forwards browser cookies to the Go API
 * so /auth/me can validate the session.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { CurrentUser } from "./api";

const API = process.env.NIXWAY_API_URL ?? "http://localhost:8080";

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader = (await cookies()).toString();
  if (!cookieHeader) return null;

  try {
    const res = await fetch(`${API}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CurrentUser;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireGuest(): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");
}
