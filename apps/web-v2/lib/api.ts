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
  ServerMetric,
  ServerRole,
  ServerTag,
  ProvisioningJob,
  ProvisioningComponent,
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
  Secret,
  Replica,
  PlacementConstraints,
  ScalingEvent,
  ScaleResult,
  VerifyDomainResult,
  TrafficView,
  AutoscalingRule,
  AutoscaleEvaluation,
  Database,
  DatabaseProvisionResult,
  DatabaseLink,
  DatabaseCredentialRotation,
  RotateCredentialsResponse,
  DatabaseBackup,
  RestoreResult,
  Template,
  TemplateVersion,
  Volume,
  VolumeSnapshot,
  SchemaList,
  TableList,
  RowPage,
  QueryResult,
  QueryHistoryEntry,
  NotificationChannel,
  AlertRule,
  AlertEvent,
  MetricSample,
  MetricRange,
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
  setRole: (teamId: string, serverId: string, role: ServerRole) =>
    api.put<Server>(`/teams/${teamId}/servers/${serverId}/role`, { role }),
  remove:  (teamId: string, serverId: string)          => api.delete<void>(`/teams/${teamId}/servers/${serverId}`),
  cleanup: (teamId: string, serverId: string)          => api.post<void>(`/teams/${teamId}/servers/${serverId}/cleanup`),
  metrics: (teamId: string, serverId: string)          => api.get<ServerMetric>(`/teams/${teamId}/servers/${serverId}/metrics`),
};

/**
 * SSH-driven server provisioning — runs component install scripts on the
 * target host and streams their output. The latest job per server is the
 * canonical record; Status returns null when the server has never been
 * provisioned. Maintenance is just re-running a single component, e.g.
 * `start(..., ["agent"])` to upgrade the agent binary in place.
 */
export const serverProvisionApi = {
  status: (teamId: string, serverId: string) =>
    api.get<ProvisioningJob | null>(`/teams/${teamId}/servers/${serverId}/provision`),
  start: (teamId: string, serverId: string, components: ProvisioningComponent[]) =>
    api.post<ProvisioningJob>(`/teams/${teamId}/servers/${serverId}/provision`, { components }),
  retry: (teamId: string, serverId: string) =>
    api.post<ProvisioningJob>(`/teams/${teamId}/servers/${serverId}/provision/retry`, {}),
  /** SSE URL for the live log stream of a specific provisioning job. */
  logsUrl: (teamId: string, serverId: string, jobId: string) =>
    `/api/v1/teams/${teamId}/servers/${serverId}/provision/${jobId}/logs`,
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
  verifyDomain: (appId: string)                                     => api.post<VerifyDomainResult>(`/apps/${appId}/domain/verify`),
  /**
   * The backend has no DELETE endpoint for the custom domain; the standard
   * Update handler is total-replace, so we re-emit every editable field and
   * just nil the domain. Caller passes the *current* App so we don't clobber
   * other settings.
   */
  removeDomain: (app: App) =>
    api.put<App>(`/projects/${app.project_id}/apps/${app.id}`, {
      name: app.name,
      branch: app.branch ?? null,
      root_path: app.root_path ?? "",
      auto_deploy: app.auto_deploy ?? false,
      builder: app.builder ?? "",
      dockerfile_path: app.dockerfile_path ?? "",
      port: app.port ?? 0,
      health_check_path: app.health_check_path ?? "",
      replicas: app.replicas ?? 1,
      custom_domain: null,
      status: app.status ?? "active",
      placement_strategy: app.placement_strategy ?? "spread",
      pinned_server_ids: app.pinned_server_ids ?? [],
    }),
  updateResources: (appId: string, input: UpdateResourcesInput)     => api.put<App>(`/apps/${appId}/resources`, input),
  rollback: (appId: string, environment_id?: string)                =>
    api.post<Deployment>(`/apps/${appId}/rollback`, environment_id ? { environment_id } : {}),
  listReplicas: (appId: string)                                     => api.get<Replica[]>(`/apps/${appId}/replicas`),
  /**
   * SSE URL for streaming a container's logs. The container query param is
   * optional; when omitted the server picks the latest replica.
   */
  logsUrl: (
    appId: string,
    opts: { container?: string; tail?: number; follow?: boolean } = {},
  ): string => {
    const qs = new URLSearchParams();
    if (opts.container) qs.set("container", opts.container);
    if (opts.tail)      qs.set("tail", String(opts.tail));
    if (opts.follow)    qs.set("follow", "true");
    const suffix = qs.toString() ? `?${qs}` : "";
    return `/api/v1/apps/${appId}/logs${suffix}`;
  },
  scale: (appId: string, input: ScaleInput) =>
    api.post<ScaleResult>(`/apps/${appId}/scale`, input),
  listScalingEvents: (appId: string, opts: { limit?: number; offset?: number } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit  != null) qs.set("limit",  String(opts.limit));
    if (opts.offset != null) qs.set("offset", String(opts.offset));
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<ScalingEvent[]>(`/apps/${appId}/scaling-events${suffix}`);
  },
  getTraffic: (appId: string) => api.get<TrafficView>(`/apps/${appId}/traffic`),
  updateTraffic: (appId: string, weights: TrafficWeightInput[]) =>
    api.put<TrafficView>(`/apps/${appId}/traffic`, { weights }),
  /** Sets the chosen backend's weight to 100 and zeroes the rest. */
  promoteBackend: (appId: string, backendId: string) =>
    api.post<TrafficView>(`/apps/${appId}/traffic/backends/${backendId}/promote`),
  listAutoscalingRules: (appId: string) =>
    api.get<AutoscalingRule[]>(`/apps/${appId}/autoscaling-rules`),
  createAutoscalingRule: (appId: string, input: CreateAutoscalingRuleInput) =>
    api.post<AutoscalingRule>(`/apps/${appId}/autoscaling-rules`, input),
  deleteAutoscalingRule: (appId: string, ruleId: string) =>
    api.delete<void>(`/apps/${appId}/autoscaling-rules/${ruleId}`),
  evaluateAutoscaling: (appId: string) =>
    api.post<AutoscaleEvaluation[]>(`/apps/${appId}/autoscaling/evaluate`),
};

export interface TrafficWeightInput {
  backend_id: string;
  weight: number;
}

export interface CreateAutoscalingRuleInput {
  name?: string;
  metric_name?: string;
  comparison?: string;
  threshold: number;
  duration_seconds?: number;
  action_type?: string;
  action_value?: number;
  min_replicas?: number;
  max_replicas?: number;
  cooldown_up_seconds?: number;
  cooldown_down_seconds?: number;
  enabled?: boolean;
}

export interface ScaleInput {
  replicas: number;
  placement_strategy?: "spread" | "binpack" | "pinned" | string;
  placement_constraints?: PlacementConstraints;
  pinned_server_ids?: string[];
}

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

/* ─── Secrets ─── */

export interface CreateSecretInput {
  environment: string;
  key: string;
  value: string;
}

export const secretsApi = {
  list:   (teamId: string, environment?: string) => {
    const qs = environment ? `?environment=${encodeURIComponent(environment)}` : "";
    return api.get<Secret[]>(`/teams/${teamId}/secrets${qs}`);
  },
  get:    (teamId: string, secretId: string)             => api.get<Secret>(`/teams/${teamId}/secrets/${secretId}`),
  create: (teamId: string, input: CreateSecretInput)     => api.post<Secret>(`/teams/${teamId}/secrets`, input),
  /** Rotate the value, bumping the version. */
  update: (teamId: string, secretId: string, value: string) =>
    api.put<Secret>(`/teams/${teamId}/secrets/${secretId}`, { value }),
  /** One-time reveal — 409 ApiError if already revealed. */
  reveal: (teamId: string, secretId: string)             =>
    api.post<{ value: string }>(`/teams/${teamId}/secrets/${secretId}/reveal`),
  remove: (teamId: string, secretId: string)             => api.delete<void>(`/teams/${teamId}/secrets/${secretId}`),
};

/* ─── Service templates (databases/caches/queues catalog) ─── */

export const templatesApi = {
  list:         ()                  => api.get<Template[]>("/templates"),
  get:          (slug: string)      => api.get<Template>(`/templates/${slug}`),
  listVersions: (slug: string)      => api.get<TemplateVersion[]>(`/templates/${slug}/versions`),
};

/* ─── Databases ─── */

export interface ProvisionDatabaseInput {
  cluster_id: string;
  server_id?: string;
  template_slug: string;
  version: string;
  name: string;
  size_gb?: number;
  cpu_millicores?: number;
  memory_mb?: number;
  backup_schedule?: string;
  retention_days?: number;
}

export interface LinkDatabaseInput {
  app_id: string;
  env_prefix?: string;
}

export const databasesApi = {
  list:    (projectId: string)                       => api.get<Database[]>(`/projects/${projectId}/databases`),
  get:     (projectId: string, dbId: string)         => api.get<Database>(`/projects/${projectId}/databases/${dbId}`),
  getByID: (dbId: string)                            => api.get<Database>(`/databases/${dbId}`),
  provision: (projectId: string, input: ProvisionDatabaseInput) =>
    api.post<DatabaseProvisionResult>(`/projects/${projectId}/databases`, input),
  /** SSE URL — open via EventSource on the client. Yields ProvisionLogEntry events. */
  provisionStreamUrl: (projectId: string, dbId: string) =>
    `/api/v1/projects/${projectId}/databases/${dbId}/provision-stream`,
  remove:  (projectId: string, dbId: string)         => api.delete<void>(`/projects/${projectId}/databases/${dbId}`),
  start:   (projectId: string, dbId: string)         => api.post<Database>(`/projects/${projectId}/databases/${dbId}/start`),
  stop:    (projectId: string, dbId: string)         => api.post<Database>(`/projects/${projectId}/databases/${dbId}/stop`),
  listLinks: (projectId: string, dbId: string)       => api.get<DatabaseLink[]>(`/projects/${projectId}/databases/${dbId}/links`),
  link:    (projectId: string, dbId: string, input: LinkDatabaseInput) =>
    api.post<DatabaseLink>(`/projects/${projectId}/databases/${dbId}/links`, input),
  unlink:  (projectId: string, dbId: string, linkId: string) =>
    api.delete<{ status: string }>(`/projects/${projectId}/databases/${dbId}/links/${linkId}`),
  rotate:  (projectId: string, dbId: string)         =>
    api.post<RotateCredentialsResponse>(`/projects/${projectId}/databases/${dbId}/rotate`),
  listRotations: (projectId: string, dbId: string)   =>
    api.get<DatabaseCredentialRotation[]>(`/projects/${projectId}/databases/${dbId}/rotations`),
  listBackups: (projectId: string, dbId: string)     =>
    api.get<DatabaseBackup[]>(`/projects/${projectId}/databases/${dbId}/backups`),
  createBackup: (projectId: string, dbId: string)    =>
    api.post<DatabaseBackup>(`/projects/${projectId}/databases/${dbId}/backups`),
  getBackup: (projectId: string, dbId: string, backupId: string) =>
    api.get<DatabaseBackup>(`/projects/${projectId}/databases/${dbId}/backups/${backupId}`),
  removeBackup: (projectId: string, dbId: string, backupId: string) =>
    api.delete<void>(`/projects/${projectId}/databases/${dbId}/backups/${backupId}`),
  /**
   * Target "in_place" restores into the source DB (destructive). Target "new"
   * provisions a fresh DB named `newName` and pipes the dump into it.
   */
  restore: (
    projectId: string,
    dbId: string,
    input: { backup_id: string; target: "in_place" | "new"; new_name?: string },
  ) => api.post<RestoreResult>(`/projects/${projectId}/databases/${dbId}/restore`, input),
};

/* ─── Volumes (team-scoped persistent storage) ─── */

export interface CreateVolumeInput {
  cluster_id: string;
  server_id: string;
  name: string;
  size_gb: number;
  filesystem?: string;
}

export interface AttachVolumeInput {
  container_name: string;
  mount_path: string;
}

export const volumesApi = {
  list:    (teamId: string)                            => api.get<Volume[]>(`/teams/${teamId}/volumes`),
  get:     (teamId: string, volumeId: string)          => api.get<Volume>(`/teams/${teamId}/volumes/${volumeId}`),
  create:  (teamId: string, input: CreateVolumeInput)  => api.post<Volume>(`/teams/${teamId}/volumes`, input),
  remove:  (teamId: string, volumeId: string)          => api.delete<void>(`/teams/${teamId}/volumes/${volumeId}`),
  attach:  (teamId: string, volumeId: string, input: AttachVolumeInput) =>
    api.post<Volume>(`/teams/${teamId}/volumes/${volumeId}/attach`, input),
  detach:  (teamId: string, volumeId: string)          =>
    api.post<Volume>(`/teams/${teamId}/volumes/${volumeId}/detach`),
  move:    (teamId: string, volumeId: string, target_server_id: string) =>
    api.post<Volume>(`/teams/${teamId}/volumes/${volumeId}/move`, { target_server_id }),
  resize:  (teamId: string, volumeId: string, new_size_gb: number) =>
    api.post<Volume>(`/teams/${teamId}/volumes/${volumeId}/resize`, { new_size_gb }),
  snapshot: (teamId: string, volumeId: string)         =>
    api.post<VolumeSnapshot>(`/teams/${teamId}/volumes/${volumeId}/snapshot`),
  listSnapshots: (teamId: string, volumeId: string)    =>
    api.get<VolumeSnapshot[]>(`/teams/${teamId}/volumes/${volumeId}/snapshots`),
};

/* ─── Database tooling (SQL terminal + browser) ─── */

export interface RowsQuery {
  page?: number;
  limit?: number;
  sort?: string;
  order?: "asc" | "desc";
}

export interface RunQueryInput {
  sql: string;
  /** Must be true for INSERT/UPDATE/DELETE/DDL — guards against accidental writes. */
  write_mode?: boolean;
}

export const dbToolingApi = {
  listSchemas: (dbId: string) => api.get<SchemaList>(`/databases/${dbId}/schemas`),
  listTables:  (dbId: string, schema: string) =>
    api.get<TableList>(`/databases/${dbId}/schemas/${encodeURIComponent(schema)}/tables`),
  getTableRows: (
    dbId: string,
    schema: string,
    table: string,
    q: RowsQuery = {},
  ) => {
    const qs = new URLSearchParams();
    if (q.page  != null) qs.set("page",  String(q.page));
    if (q.limit != null) qs.set("limit", String(q.limit));
    if (q.sort)          qs.set("sort", q.sort);
    if (q.order)         qs.set("order", q.order);
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<RowPage>(
      `/databases/${dbId}/schemas/${encodeURIComponent(schema)}/tables/${encodeURIComponent(table)}/rows${suffix}`,
    );
  },
  runQuery: (dbId: string, input: RunQueryInput) =>
    api.post<QueryResult>(`/databases/${dbId}/query`, input),
  listQueryHistory: (dbId: string, limit = 50) =>
    api.get<QueryHistoryEntry[]>(`/databases/${dbId}/query-history?limit=${limit}`),
};

/* ─── Observability (alerts + notification channels) ─── */

export interface CreateChannelInput {
  name: string;
  type: string;
  target: string;
  enabled?: boolean;
}

export interface AlertRuleInput {
  scope_type: string;
  scope_id: string;
  name: string;
  metric_name: string;
  comparison: string;
  threshold: number;
  duration_seconds: number;
  severity: string;
  enabled?: boolean;
  notification_channels?: string[];
}

export interface AlertsScopeQuery {
  scope_type?: string;
  scope_id?: string;
}

export const observabilityApi = {
  listChannels: (teamId: string) =>
    api.get<NotificationChannel[]>(`/teams/${teamId}/observability/channels`),
  createChannel: (teamId: string, input: CreateChannelInput) =>
    api.post<NotificationChannel>(`/teams/${teamId}/observability/channels`, input),
  listAlerts: (teamId: string, scope: AlertsScopeQuery = {}) => {
    const qs = new URLSearchParams();
    if (scope.scope_type) qs.set("scope_type", scope.scope_type);
    if (scope.scope_id)   qs.set("scope_id",   scope.scope_id);
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<AlertRule[]>(`/teams/${teamId}/observability/alerts${suffix}`);
  },
  createAlert: (teamId: string, input: AlertRuleInput) =>
    api.post<AlertRule>(`/teams/${teamId}/observability/alerts`, input),
  updateAlert: (teamId: string, alertId: string, input: AlertRuleInput) =>
    api.put<AlertRule>(`/teams/${teamId}/observability/alerts/${alertId}`, input),
  deleteAlert: (teamId: string, alertId: string) =>
    api.delete<void>(`/teams/${teamId}/observability/alerts/${alertId}`),
  evaluateAlerts: (teamId: string) =>
    api.post<{ ok: boolean }>(`/teams/${teamId}/observability/alerts/evaluate`),
  listEvents: (teamId: string, opts: { limit?: number; scope_type?: string; scope_id?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.limit      != null) qs.set("limit", String(opts.limit));
    if (opts.scope_type)         qs.set("scope_type", opts.scope_type);
    if (opts.scope_id)           qs.set("scope_id", opts.scope_id);
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<AlertEvent[]>(`/teams/${teamId}/observability/events${suffix}`);
  },
  /** Latest sample per known metric for the given scope. */
  latestMetrics: (teamId: string, scope_type: string, scope_id: string) => {
    const qs = new URLSearchParams({ scope_type, scope_id });
    return api.get<MetricSample[]>(`/teams/${teamId}/observability/metrics?${qs}`);
  },
  /** Time series for a single metric on a scope. */
  metricRange: (
    teamId: string,
    scope_type: string,
    scope_id: string,
    metric: string,
    range: MetricRange = "1h",
    limit?: number,
  ) => {
    const qs = new URLSearchParams({ scope_type, scope_id, metric, range });
    if (limit != null) qs.set("limit", String(limit));
    return api.get<MetricSample[]>(`/teams/${teamId}/observability/metrics?${qs}`);
  },
};
