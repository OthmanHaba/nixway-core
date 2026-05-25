/**
 * Client-side API wrapper. Talks to the Go API at /api/v1, with cookies.
 * Mirrors the error envelope: { error: string, code?: string }
 */

const BASE = "/api/v1";

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
  init?: RequestInit,
): Promise<T> {
  const headers: HeadersInit = {
    ...(body ? { "Content-Type": "application/json" } : {}),
    ...(init?.headers ?? {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "include",
    cache: "no-store",
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text ? safeJson(text) : undefined;

  if (!res.ok) {
    const msg =
      (data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : undefined) ||
      (data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : undefined) ||
      res.statusText ||
      "Request failed";
    const code =
      data && typeof data === "object" && "code" in data && typeof data.code === "string"
        ? data.code
        : undefined;
    throw new ApiError(res.status, msg, code);
  }

  return (data as T) ?? (undefined as T);
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}

export const api = {
  get:    <T>(p: string, init?: RequestInit)              => request<T>("GET", p, undefined, init),
  post:   <T>(p: string, body?: unknown, init?: RequestInit) => request<T>("POST", p, body, init),
  put:    <T>(p: string, body?: unknown, init?: RequestInit) => request<T>("PUT", p, body, init),
  patch:  <T>(p: string, body?: unknown, init?: RequestInit) => request<T>("PATCH", p, body, init),
  delete: <T = void>(p: string, init?: RequestInit)       => request<T>("DELETE", p, undefined, init),
};

/* ─── Auth-specific surface ─── */

export type CurrentUser = {
  id: string;
  email: string;
  name: string;
  email_verified?: boolean;
};

export const authApi = {
  me:     () => api.get<CurrentUser>("/auth/me"),
  login:  (email: string, password: string) =>
    api.post<{ user: CurrentUser }>("/auth/login", { email, password }),
  signup: (name: string, email: string, password: string) =>
    api.post<{ user: CurrentUser }>("/auth/signup", { name, email, password }),
  logout: () => api.post<void>("/auth/logout"),
  forgotPassword: (email: string) =>
    api.post<void>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    api.post<void>("/auth/reset-password", { token, password }),
  verifyEmail: (token: string) =>
    api.post<void>("/auth/verify-email", { token }),
};
