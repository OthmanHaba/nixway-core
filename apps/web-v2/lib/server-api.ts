/**
 * Server-side fetch wrapper used by RSC and route handlers.
 * Forwards browser cookies to the Go API so session auth works.
 *
 * Mirrors the client `api` surface in shape so call sites read the same.
 *
 * IMPORTANT: We forward the raw `cookie:` header from the incoming request
 * rather than re-serializing via cookies().toString() — the latter
 * percent-encodes `=` characters in base64 session IDs, which silently
 * breaks Go-side session lookup.
 */
import { headers } from "next/headers";

// Default to 127.0.0.1 (not "localhost") because Node.js 17+ resolves
// "localhost" to ::1 first, which the Go API may not be listening on.
const API = process.env.NIXWAY_API_URL ?? "http://127.0.0.1:8080";
const BASE = `${API}/api/v1`;

export class ServerApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ServerApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const cookieHeader = (await headers()).get("cookie");

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const msg = pickString(data, ["error", "message"]) ?? res.statusText ?? "Request failed";
    const code = pickString(data, ["code"]);
    throw new ServerApiError(res.status, msg, code);
  }
  return (data as T) ?? (undefined as T);
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

function pickString(v: unknown, keys: string[]): string | undefined {
  if (!v || typeof v !== "object") return undefined;
  for (const k of keys) {
    const value = (v as Record<string, unknown>)[k];
    if (typeof value === "string") return value;
  }
  return undefined;
}

export const serverApi = {
  get:    <T>(p: string)                  => request<T>("GET", p),
  post:   <T>(p: string, body?: unknown)  => request<T>("POST", p, body),
  put:    <T>(p: string, body?: unknown)  => request<T>("PUT", p, body),
  delete: <T = void>(p: string)           => request<T>("DELETE", p),
};

/**
 * Same as serverApi.get but swallows non-success responses, returning a
 * fallback. Useful for non-critical dashboard tiles where one broken endpoint
 * shouldn't kill the whole page.
 */
export async function tryGet<T>(path: string, fallback: T): Promise<T> {
  try {
    return await serverApi.get<T>(path);
  } catch {
    return fallback;
  }
}
