/**
 * Client-side API wrapper. Talks to the Go API at /api/v1, with cookies.
 * Mirrors the error envelope: { error: string, code?: string }
 */
import type { Team, TeamMember, TeamInvite, Role, ApiToken, AuditLog } from "./types";

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

/* ─── Teams ─── */

export const teamsApi = {
  list:   ()                                    => api.get<Team[]>("/teams"),
  get:    (id: string)                          => api.get<Team>(`/teams/${id}`),
  create: (name: string)                        => api.post<Team>("/teams", { name }),
  update: (id: string, name: string)            => api.put<Team>(`/teams/${id}`, { name }),
  remove: (id: string)                          => api.delete<void>(`/teams/${id}`),
};

export const membersApi = {
  list:       (teamId: string)                                => api.get<TeamMember[]>(`/teams/${teamId}/members`),
  updateRole: (teamId: string, userId: string, role: Role)    =>
    api.put<TeamMember>(`/teams/${teamId}/members/${userId}`, { role }),
  remove:     (teamId: string, userId: string)                =>
    api.delete<void>(`/teams/${teamId}/members/${userId}`),
};

export const invitesApi = {
  list:   (teamId: string)                              => api.get<TeamInvite[]>(`/teams/${teamId}/invites`),
  create: (teamId: string, email: string, role: Role)   =>
    api.post<TeamInvite>(`/teams/${teamId}/invites`, { email, role }),
  cancel: (teamId: string, inviteId: string)            =>
    api.delete<void>(`/teams/${teamId}/invites/${inviteId}`),
};

/* ─── API tokens ─── */

export interface CreateTokenInput {
  name: string;
  scopes: string[];
  /** Go-style duration string, e.g. "720h" for 30 days. Optional. */
  expires_in?: string;
}

export const tokensApi = {
  list:   (teamId: string) => api.get<ApiToken[]>(`/teams/${teamId}/tokens`),
  create: (teamId: string, input: CreateTokenInput) =>
    api.post<ApiToken>(`/teams/${teamId}/tokens`, input),
  revoke: (teamId: string, tokenId: string) =>
    api.delete<void>(`/teams/${teamId}/tokens/${tokenId}`),
};

/* ─── Audit log ─── */

export interface AuditFilters {
  action?: string;
  resource_type?: string;
  actor_id?: string;
  /** RFC3339 timestamp — paginate by passing the last row's created_at. */
  before?: string;
  page_size?: number;
}

export const auditApi = {
  list: (teamId: string, filters: AuditFilters = {}) => {
    const qs = new URLSearchParams();
    if (filters.action)        qs.set("action", filters.action);
    if (filters.resource_type) qs.set("resource_type", filters.resource_type);
    if (filters.actor_id)      qs.set("actor_id", filters.actor_id);
    if (filters.before)        qs.set("before", filters.before);
    if (filters.page_size)     qs.set("page_size", String(filters.page_size));
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<AuditLog[]>(`/teams/${teamId}/audit-logs${suffix}`);
  },
};
