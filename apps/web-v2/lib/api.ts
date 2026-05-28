/**
 * Client-side API wrapper. Talks to the Go API at /api/v1, with cookies.
 * Mirrors the error envelope: { error: string, code?: string }
 */
import type {
  Team,
  TeamMember,
  TeamInvite,
  Role,
  ApiToken,
  AuditLog,
  Server,
  ServerDetail,
  ServerTag,
  SshKey,
  SshKeyType,
  Cluster,
  ClusterMember,
  MeshPeer,
  Project,
  Environment,
  App,
  Build,
  Deployment,
  DeploymentTarget,
} from "./types";

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

/* ─── Servers ─── */

export interface CreateServerInput {
  name: string;
  hostname: string;
  public_ip: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_key_id: string;
}

export const serversApi = {
  list:    (teamId: string)                            => api.get<Server[]>(`/teams/${teamId}/servers`),
  get:     (teamId: string, serverId: string)          => api.get<ServerDetail>(`/teams/${teamId}/servers/${serverId}`),
  create:  (teamId: string, input: CreateServerInput)  => api.post<Server>(`/teams/${teamId}/servers`, input),
  rename:  (teamId: string, serverId: string, name: string) =>
    api.put<Server>(`/teams/${teamId}/servers/${serverId}`, { name }),
  remove:  (teamId: string, serverId: string)          => api.delete<void>(`/teams/${teamId}/servers/${serverId}`),
  cleanup: (teamId: string, serverId: string)          => api.post<void>(`/teams/${teamId}/servers/${serverId}/cleanup`),
};

export const tagsApi = {
  list:   (teamId: string, serverId: string) => api.get<ServerTag[]>(`/teams/${teamId}/servers/${serverId}/tags`),
  set:    (teamId: string, serverId: string, key: string, value: string) =>
    api.post<ServerTag>(`/teams/${teamId}/servers/${serverId}/tags`, { key, value }),
  remove: (teamId: string, serverId: string, key: string) =>
    api.delete<void>(`/teams/${teamId}/servers/${serverId}/tags/${encodeURIComponent(key)}`),
};

/* ─── SSH keys ─── */

export interface CreateSshKeyInput {
  name: string;
  /** When key_type is provided alone, the server generates a fresh pair. */
  key_type?: SshKeyType;
  /** Both public_key and private_key together upload an existing pair. */
  public_key?: string;
  private_key?: string;
}

export const sshKeysApi = {
  list:   (teamId: string)                           => api.get<SshKey[]>(`/teams/${teamId}/ssh-keys`),
  get:    (teamId: string, keyId: string)            => api.get<SshKey>(`/teams/${teamId}/ssh-keys/${keyId}`),
  create: (teamId: string, input: CreateSshKeyInput) => api.post<SshKey>(`/teams/${teamId}/ssh-keys`, input),
  remove: (teamId: string, keyId: string)            => api.delete<void>(`/teams/${teamId}/ssh-keys/${keyId}`),
};

/* ─── Clusters ─── */

export interface CreateClusterInput {
  name: string;
  description?: string;
  region?: string;
}

export interface UpdateClusterInput {
  name?: string;
  description?: string;
  region?: string;
}

export const clustersApi = {
  list:   (teamId: string)                                 => api.get<Cluster[]>(`/teams/${teamId}/clusters`),
  get:    (teamId: string, clusterId: string)              => api.get<Cluster>(`/teams/${teamId}/clusters/${clusterId}`),
  create: (teamId: string, input: CreateClusterInput)      => api.post<Cluster>(`/teams/${teamId}/clusters`, input),
  update: (teamId: string, clusterId: string, patch: UpdateClusterInput) =>
    api.put<Cluster>(`/teams/${teamId}/clusters/${clusterId}`, patch),
  remove: (teamId: string, clusterId: string)              => api.delete<void>(`/teams/${teamId}/clusters/${clusterId}`),
};

export const clusterMembersApi = {
  list:   (teamId: string, clusterId: string) =>
    api.get<ClusterMember[]>(`/teams/${teamId}/clusters/${clusterId}/members`),
  add:    (teamId: string, clusterId: string, serverId: string) =>
    api.post<ClusterMember>(`/teams/${teamId}/clusters/${clusterId}/members`, { server_id: serverId }),
  remove: (teamId: string, clusterId: string, serverId: string) =>
    api.delete<void>(`/teams/${teamId}/clusters/${clusterId}/members/${serverId}`),
};

export const meshApi = {
  health:     (teamId: string, clusterId: string) =>
    api.get<MeshPeer[]>(`/teams/${teamId}/clusters/${clusterId}/mesh`),
  regenerate: (teamId: string, clusterId: string) =>
    api.post<void>(`/teams/${teamId}/clusters/${clusterId}/mesh/regenerate`),
};

/* ─── Projects ─── */

export interface CreateProjectInput {
  name: string;
  cluster_id: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

export const projectsApi = {
  list:   (teamId: string)                                        => api.get<Project[]>(`/teams/${teamId}/projects`),
  get:    (teamId: string, projectId: string)                     => api.get<Project>(`/teams/${teamId}/projects/${projectId}`),
  create: (teamId: string, input: CreateProjectInput)             => api.post<Project>(`/teams/${teamId}/projects`, input),
  update: (teamId: string, projectId: string, patch: UpdateProjectInput) =>
    api.put<Project>(`/teams/${teamId}/projects/${projectId}`, patch),
  remove: (teamId: string, projectId: string)                     => api.delete<void>(`/teams/${teamId}/projects/${projectId}`),
};

export const environmentsApi = {
  list:   (projectId: string)                       => api.get<Environment[]>(`/projects/${projectId}/environments`),
  create: (projectId: string, name: string)         => api.post<Environment>(`/projects/${projectId}/environments`, { name }),
};

/* ─── Apps ─── */

export interface CreateAppInput {
  name: string;
  source_type: "github" | "docker_image";
  github_installation_id?: string;
  repo_full_name?: string;
  branch?: string;
  docker_image?: string;
  registry_credential_id?: string;
  root_path?: string;
  builder?: string;
  dockerfile_path?: string;
  auto_deploy?: boolean;
  port?: number;
  health_check_path?: string;
  health_check_interval?: number;
  health_check_timeout?: number;
  replicas?: number;
  subdomain?: string;
  placement_strategy?: "spread" | "binpack" | "pinned";
  pinned_server_ids?: string[];
}

export interface UpdateAppInput {
  name?: string;
  branch?: string | null;
  root_path?: string;
  auto_deploy?: boolean;
  builder?: string;
  dockerfile_path?: string;
  port?: number;
  health_check_path?: string;
  health_check_interval?: number;
  health_check_timeout?: number;
  replicas?: number;
  subdomain?: string | null;
  custom_domain?: string | null;
  status?: string;
  placement_strategy?: string;
}

export interface UpdateResourcesInput {
  memory_limit_mb: number;
  cpu_limit_millicores: number;
}

export const appsApi = {
  list:   (projectId: string)                                       => api.get<App[]>(`/projects/${projectId}/apps`),
  get:    (appId: string)                                           => api.get<App>(`/apps/${appId}`),
  create: (projectId: string, input: CreateAppInput)                => api.post<App>(`/projects/${projectId}/apps`, input),
  update: (projectId: string, appId: string, patch: UpdateAppInput) => api.put<App>(`/projects/${projectId}/apps/${appId}`, patch),
  remove: (projectId: string, appId: string)                        => api.delete<void>(`/projects/${projectId}/apps/${appId}`),
  setDomain:    (appId: string, custom_domain: string)              => api.post<App>(`/apps/${appId}/domain`, { custom_domain }),
  verifyDomain: (appId: string)                                     => api.post<App>(`/apps/${appId}/domain/verify`),
  updateResources: (appId: string, input: UpdateResourcesInput)     => api.put<App>(`/apps/${appId}/resources`, input),
  rollback: (appId: string, environment_id?: string)                =>
    api.post<Deployment>(`/apps/${appId}/rollback`, environment_id ? { environment_id } : {}),
};

/* ─── Builds ─── */

export interface TriggerBuildInput {
  environment_id?: string;
  commit_sha?: string;
  branch?: string;
}

export const buildsApi = {
  list:    (appId: string)                          => api.get<Build[]>(`/apps/${appId}/builds`),
  get:     (appId: string, buildId: string)         => api.get<Build>(`/apps/${appId}/builds/${buildId}`),
  trigger: (appId: string, input: TriggerBuildInput = {}) =>
    api.post<Build>(`/apps/${appId}/builds`, input),
  /** SSE URL — open via EventSource on the client. */
  logsUrl: (appId: string, buildId: string)         => `/api/v1/apps/${appId}/builds/${buildId}/logs`,
};

/* ─── Deployments ─── */

export const deploymentsApi = {
  list:    (appId: string)                                  => api.get<Deployment[]>(`/apps/${appId}/deployments`),
  get:     (appId: string, deployId: string)                => api.get<Deployment>(`/apps/${appId}/deployments/${deployId}`),
  targets: (appId: string, deployId: string)                => api.get<DeploymentTarget[]>(`/apps/${appId}/deployments/${deployId}/targets`),
  logsUrl: (appId: string, deployId: string)                => `/api/v1/apps/${appId}/deployments/${deployId}/logs`,
};
