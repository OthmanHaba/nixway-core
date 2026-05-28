/**
 * Server-side auth helpers for RSC. Forwards browser cookies to the Go API
 * so /auth/me can validate the session.
 *
 * IMPORTANT: We use `headers().get("cookie")` to forward the *raw* cookie
 * header from the browser. Using `cookies().toString()` percent-encodes the
 * cookie values (e.g. trailing `=` in base64 session IDs becomes `%3D`),
 * which silently breaks server-side session validation.
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import type { CurrentUser } from "./api";

// Default to 127.0.0.1 (not "localhost") because Node.js 17+ resolves
// "localhost" to ::1 first, which the Go API may not be listening on.
const API = process.env.NIXWAY_API_URL ?? "http://127.0.0.1:8080";

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const cookieHeader = (await headers()).get("cookie");
  if (!cookieHeader) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] no cookies on request");
    }
    return null;
  }

  try {
    const res = await fetch(`${API}/api/v1/auth/me`, {
      headers: { cookie: cookieHeader },
      cache: "no-store",
    });
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`[auth] /auth/me -> ${res.status}`);
      }
      return null;
    }
    return (await res.json()) as CurrentUser;
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[auth] /auth/me fetch failed:", err);
    }
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
