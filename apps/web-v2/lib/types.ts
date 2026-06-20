/**
 * Shared TS types mirroring internal/model in the Go backend.
 * Keep field names in sync with the JSON tags on Go structs.
 */

export interface User {
  id: string;
  email: string;
  name: string;
  email_verified?: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
}

export type Role = "owner" | "admin" | "member";

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  role: Role;
  email: string;
  user_name: string;
  created_at: string;
}

export interface TeamInvite {
  id: string;
  team_id: string;
  email: string;
  role: Role;
  inviter_name?: string;
  expires_at: string;
  created_at: string;
}

export interface ApiToken {
  id: string;
  team_id: string;
  user_id: string;
  name: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  created_at: string;
  /** Present only on creation (one-time reveal). */
  token?: string;
}

export interface AuditLog {
  id: string;
  team_id: string;
  actor_id: string | null;
  actor_type: "user" | "system" | "api_token";
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  metadata: unknown;
  ip_address: string;
  created_at: string;
}

export type ServerStatus =
  | "online"
  | "offline"
  | "degraded"
  | "provisioning"
  | "unknown";

export type ServerRole = "worker" | "edge" | "both";

export const SERVER_ROLES: { value: ServerRole; label: string; description: string }[] = [
  {
    value: "worker",
    label: "Worker",
    description: "Runs app & database containers scheduled by the cluster.",
  },
  {
    value: "edge",
    label: "Edge",
    description: "Fronts the cluster with Traefik; routes public traffic to workers over the mesh.",
  },
  {
    value: "both",
    label: "Edge + Worker",
    description: "Runs the edge LB and worker containers on the same node — for small / single-node clusters.",
  },
];

export interface Server {
  id: string;
  team_id: string;
  agent_id: string | null;
  name: string;
  hostname: string;
  public_ip: string;
  ssh_port: number;
  ssh_user: string;
  os: string | null;
  os_version: string | null;
  arch: string | null;
  status: ServerStatus;
  role: ServerRole;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerTag {
  id?: string;
  server_id?: string;
  key: string;
  value: string;
  created_at?: string;
}

/**
 * Hardware/runtime snapshot reported by the server's agent. All fields are
 * optional because the agent populates them asynchronously after onboarding.
 */
export interface ServerResources {
  server_id: string;
  cpu_model: string | null;
  cpu_cores: number | null;
  memory_total: number | null;     // bytes
  memory_available: number | null; // bytes
  kernel_version: string | null;
  docker_version: string | null;
  disks: unknown;                  // JSONB — opaque on the client for now
  network_interfaces: unknown;     // JSONB — opaque on the client for now
  updated_at: string;
}

export interface ServerDetail extends Server {
  resources?: ServerResources | null;
}

export interface ServerMetric {
  server_id: string;
  cpu_percent: number;
  memory_total: number;     // bytes
  memory_used: number;      // bytes
  memory_percent: number;
  updated_at: string;
  /** False when the latest sample is older than the freshness window (2m). */
  fresh: boolean;
}

/** State machine for a server-provisioning job (Ansible-style component runs). */
export type ProvisioningJobStatus = "pending" | "running" | "completed" | "failed";

/** Per-component state inside a job. Mirrors the JSONB row written by the service. */
export type ProvisioningStepStatus = "pending" | "running" | "succeeded" | "failed";

export interface ProvisioningStep {
  component: ProvisioningComponent | string;
  status: ProvisioningStepStatus;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string;
}

/**
 * One SSH-driven provisioning run on a server. Each job installs a chosen set
 * of components (docker, traefik, nixpacks, buildpacks, railpack, agent) and
 * captures the stdout/stderr of each script into `logs`.
 */
export interface ProvisioningJob {
  id: string;
  server_id: string;
  components: ProvisioningComponent[];
  status: ProvisioningJobStatus;
  /** Newline-separated stdout/stderr accumulated from each component script. */
  logs: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
  /** Structured per-component progress; empty array on older jobs. */
  steps: ProvisioningStep[];
}

/** Components installable via the platform's SSH-driven provisioner. */
export type ProvisioningComponent =
  | "docker"
  | "traefik"
  | "edge-lb"
  | "nixpacks"
  | "buildpacks"
  | "railpack"
  | "agent";

/** Catalog of components — kept in sync with internal/provisioner/embed.go. */
export const PROVISIONING_COMPONENTS: ReadonlyArray<{
  id: ProvisioningComponent;
  label: string;
  description: string;
}> = [
  { id: "docker",     label: "Docker",                  description: "Container runtime used to run apps and managed databases." },
  { id: "traefik",    label: "Traefik (per-node)",      description: "Per-node proxy via Docker labels + file provider. Pick this for worker or single-node servers." },
  { id: "edge-lb",    label: "Edge LB",                 description: "Front-of-cluster Traefik on host network. Route public traffic to workers over the mesh. Pick this on dedicated edge nodes." },
  { id: "nixpacks",   label: "Nixpacks",                description: "Auto-detect builder for source-based deploys (Railway-style)." },
  { id: "buildpacks", label: "Cloud Native Buildpacks", description: "Optional pack CLI for buildpack-based image production." },
  { id: "railpack",   label: "Railpack",                description: "Alternative source builder." },
  { id: "agent",      label: "Nixway agent",            description: "Always installed last. Re-run on its own to upgrade the binary." },
];

export type SshKeyType = "ed25519" | "rsa";

export interface SshKey {
  id: string;
  team_id: string;
  name: string;
  public_key: string;
  key_type: SshKeyType | string;
  fingerprint: string;
  created_at: string;
  updated_at?: string;
  /** Only present on freshly generated keys (one-time reveal). */
  private_key?: string;
}

export type ClusterStatus = "active" | "degraded" | "error" | "provisioning";

export interface Cluster {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  description: string;
  region: string;
  cidr: string;
  status: ClusterStatus | string;
  created_at: string;
  updated_at: string;
}

export interface ClusterMember {
  id: string;
  cluster_id: string;
  server_id: string;
  wireguard_ip: string;
  public_key?: string;
  status: string;
  /** Joined from servers — present when the API joins on lookup. */
  server_name?: string;
  server_hostname?: string;
  created_at: string;
}

/**
 * Each peer is a directional edge in the WireGuard mesh, joined with
 * member + server info on the API side.
 */
export interface MeshPeer {
  id: string;
  member_id: string;
  peer_member_id: string;
  status: string;
  last_handshake_at: string | null;
  last_check_at: string | null;
  rtt_ms: number | null;
  created_at: string;
  from_ip: string;
  from_server_name: string;
  to_ip: string;
  to_server_name: string;
}

export interface Project {
  id: string;
  team_id: string;
  cluster_id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  created_at: string;
  updated_at: string;
  cluster_name?: string;
}

export interface Environment {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  is_production: boolean;
  created_at: string;
}

/**
 * App-level environment variable, scoped to a single (app, environment).
 * Values are encrypted at rest and never returned by list — use reveal.
 */
export interface AppEnvVar {
  id: string;
  app_id: string;
  environment_id: string;
  key: string;
  created_at: string;
  updated_at: string;
}

/** A GitHub App installation available to a team (account = org or user). */
export interface GithubInstallation {
  id: string;              // installation row UUID — stored on the app
  github_app_id: string;
  installation_id: number; // numeric GitHub installation id
  account_login: string;
  account_type: string;    // "Organization" | "User"
  target_type: string;
  suspended_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** A repository reachable through a GitHub App installation. */
export interface GithubRepo {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  clone_url: string;
}

/** The GitHub App connected to a team (registered via the manifest flow). */
export interface GithubApp {
  id: string;
  app_id: number;
  app_name: string;
  app_slug: string;
  html_url: string;
  created_at: string;
}

/** A stored container-registry credential. Secrets are never returned. */
export interface RegistryCredential {
  id: string;
  team_id: string;
  name: string;
  registry_type: "dockerhub" | "ghcr" | "ecr" | "generic";
  registry_url: string;
  username: string;
  region?: string | null;
  validated_at?: string | null;
  created_at: string;
  updated_at: string;
}

/** A public Docker Hub image (search result). */
export interface DockerHubImage {
  name: string;          // "nginx" or "owner/repo"
  description: string;
  is_official: boolean;
  star_count: number;
  pull_count?: number;
}

/** A published tag for a Docker Hub image. */
export interface DockerHubTag {
  name: string;
  size?: number;
  last_updated?: string;
}

export type AppSourceType = "github" | "docker_image" | string;
export type AppStatus = "active" | "paused" | "error" | "building" | "deploying" | string;

/**
 * App as returned by GET /projects/{id}/apps. Many fields are optional
 * because they only apply to specific source types.
 */
export interface App {
  id: string;
  project_id: string;
  name: string;
  slug: string;
  source_type: AppSourceType;
  github_installation_id?: string | null;
  repo_full_name?: string | null;
  branch?: string | null;
  root_path?: string;
  auto_deploy?: boolean;
  docker_image?: string | null;
  registry_credential_id?: string | null;
  builder?: string;
  dockerfile_path?: string;
  port?: number;
  health_check_path?: string;
  replicas?: number;
  placement_strategy?: string;
  placement_constraints?: unknown;
  pinned_server_ids?: string[];
  status: AppStatus;
  resource_cpu_millicores?: number;
  resource_memory_mb?: number;
  /** Alternate naming used by the UpdateResources endpoint. */
  cpu_limit_millicores?: number;
  memory_limit_mb?: number;
  custom_domain?: string | null;
  custom_domain_verified?: boolean;
  created_at: string;
  updated_at: string;
}

export type BuildStatus =
  | "pending"
  | "cloning"
  | "building"
  | "built"
  | "failed"
  | "cancelled"
  | string;

export interface Build {
  id: string;
  app_id: string;
  environment_id: string;
  trigger_type: "manual" | "webhook" | "auto" | string;
  commit_sha: string;
  commit_message?: string;
  branch?: string;
  builder?: string;
  image_tag?: string;
  server_id?: string | null;
  status: BuildStatus;
  logs?: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at: string;
}

export type DeploymentStatus =
  | "pending"
  | "deploying"
  | "healthy"
  | "degraded"
  | "failed"
  | "rolled_back"
  | "superseded"
  | "archived"
  | string;

export interface Deployment {
  id: string;
  app_id: string;
  environment_id: string;
  build_id: string;
  strategy: string;
  replicas_desired: number;
  replicas_ready: number;
  status: DeploymentStatus;
  started_at?: string | null;
  completed_at?: string | null;
  error?: string | null;
  platform_domain?: string;
  created_at: string;
}

export interface DeploymentTarget {
  id: string;
  deployment_id: string;
  server_id: string;
  container_id?: string | null;
  status: string;
  health_check_attempts?: number;
  started_at?: string | null;
  healthy_at?: string | null;
  stopped_at?: string | null;
  error?: string | null;
  /** Set when the cluster has an edge LB and this replica is reachable via mesh. */
  host_port?: number | null;
  bind_address?: string | null;
  /** Joined from servers in ListDeploymentTargets. */
  server_name?: string;
  public_ip?: string;
}

/**
 * Provisioned database service (e.g. a Postgres or Redis instance) running on
 * a cluster member as a managed container. Mirrors internal/db/models.go.
 */
export interface Database {
  id: string;
  team_id: string;
  project_id: string;
  cluster_id: string;
  server_id: string;
  volume_id: string | null;
  template_slug: string;
  version: string;
  name: string;
  container_name: string;
  status: string;
  port: number;
  dns_record: string | null;
  superuser_secret_id: string | null;
  appuser_secret_id: string | null;
  resource_cpu_millicores: number;
  resource_memory_mb: number;
  backup_schedule: string | null;
  backup_retention_days: number | null;
  backup_storage_type: string | null;
  provision_log: ProvisionLogEntry[];
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One entry in a database's persistent provision log. Mirrors the Go
 * publishProvision event struct — the agent emits these as it walks the
 * provisioning state machine.
 */
export interface ProvisionLogEntry {
  step: string;
  level: "info" | "warn" | "error" | string;
  message: string;
  terminal?: boolean;
  success?: boolean;
  at: string;
}

/**
 * Response of POST /projects/{}/databases. The database row is in
 * `provisioning` state and the deploy is dispatched asynchronously — clients
 * should subscribe to the provision stream for live progress.
 */
export interface DatabaseProvisionResult {
  database: Database;
  superuser_password: string;
  appuser_password: string;
}

/** Catalog entry for a provisionable service (DB/cache/queue/etc). */
export interface Template {
  slug: string;
  name: string;
  category: string;
  description?: string;
  versions: TemplateVersion[];
  default_resources: { milli_cpu: number; memory_mb: number };
  volume_spec: { mount_path: string; default_gib?: number };
  ports: number[];
  health_check: { command: string; interval?: number; timeout?: number; retries?: number };
  conn_string_fmt: string;
  env_template: Record<string, string>;
  credential_policy: string;
  shell_command: string;
  command?: string;
}

export interface TemplateVersion {
  version: string;
  image: string;
  default?: boolean;
}

/** Many-to-many between a database and an app — defines env injection prefix. */
export interface DatabaseLink {
  id: string;
  database_id: string;
  app_id: string;
  env_prefix: string;
  created_at: string;
}

/** Audit row for a credential rotation. Status is one of pending/completed/failed. */
export interface DatabaseCredentialRotation {
  id: string;
  database_id: string;
  rotated_by: string;
  old_secret_id: string | null;
  new_secret_id: string | null;
  status: string;
  linked_apps_restarted: number;
  error?: string | null;
  created_at: string;
  completed_at: string | null;
}

/**
 * Response of POST /projects/{}/databases/{}/rotate. The new password is
 * returned exactly once — surface it immediately and don't persist client-side.
 */
export interface RotateCredentialsResponse {
  new_password: string;
  rotation_id: string;
}

/**
 * Snapshot of a managed database at a point in time. Initially status is
 * `running` (in progress); the agent finalises it to `completed` or `failed`
 * asynchronously. Type is one of "manual" / "scheduled".
 */
export interface DatabaseBackup {
  id: string;
  database_id: string;
  type: string;
  status: string;
  size_bytes: number | null;
  storage_type: string;
  storage_path: string | null;
  backup_tool: string;
  triggered_by: string | null;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

/**
 * Result of POST /projects/{}/databases/{}/restore. The database is the target
 * (same as source for "in_place", or the freshly provisioned one for "new").
 * `restart_required` signals that linked apps need a redeploy to pick up the
 * restored state.
 */
export interface RestoreResult {
  database: Database;
  restart_required: boolean;
  note?: string;
}

/**
 * Persistent block volume living on a cluster member. `container_name` +
 * `mount_path` are populated once attached; `used_bytes` is reported by the
 * agent on a polling cadence.
 */
export interface Volume {
  id: string;
  team_id: string;
  cluster_id: string;
  server_id: string;
  name: string;
  size_gb: number;
  used_bytes: number;
  filesystem: string;
  mount_path: string | null;
  container_name: string | null;
  status: string;
  host_path: string;
  created_at: string;
  updated_at: string;
}

/** A point-in-time snapshot of a volume, stored in object storage. */
export interface VolumeSnapshot {
  id: string;
  volume_id: string;
  size_bytes: number;
  storage_type: string;
  storage_path: string;
  created_at: string;
}

/* ─── Database tooling (SQL terminal + browser) ─── */

export interface SchemaList {
  schemas: string[];
}

export interface TableInfo {
  name: string;
  row_count: number;
}

export interface TableList {
  tables: TableInfo[];
}

export interface QueryColumn {
  name: string;
  type_name?: string;
}

export interface QueryRow {
  values: string[];
  nulls: boolean[];
}

/**
 * Result of POST /databases/{id}/query. `success=false` carries the error in
 * `error`; UI must surface that prominently. `columns`/`rows` are only set
 * for SELECT-shaped results, while `affected_rows` covers writes.
 */
export interface QueryResult {
  success: boolean;
  error?: string;
  execution_time_ms: number;
  columns?: QueryColumn[];
  rows?: QueryRow[];
  affected_rows?: number;
  raw_text?: string;
  query_history_id: string;
}

/** Paged rows for the table browser. `total` may be -1 when COUNT(*) was skipped. */
export interface RowPage {
  columns: QueryColumn[];
  rows: QueryRow[];
  page: number;
  limit: number;
  total: number;
}

/** Persisted entry from /databases/{id}/query-history. */
export interface QueryHistoryEntry {
  id: string;
  user_id: string;
  database_id: string;
  query_text: string;
  write_mode: boolean;
  execution_time_ms: number | null;
  row_count: number | null;
  error: string | null;
  created_at: string;
}

/* ─── Observability (alerts + notification channels) ─── */

export type NotificationChannelType = "slack" | "webhook" | "discord" | "email" | string;

/**
 * Outbound notification destination. `target` is type-specific: a Slack webhook
 * URL, a generic webhook URL, a Discord webhook, or an email address.
 */
export interface NotificationChannel {
  id: string;
  team_id: string;
  name: string;
  type: NotificationChannelType;
  target: string;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

export type AlertScopeType = "server" | "cluster" | "project" | "app" | "container" | string;

/**
 * Declarative alert tied to a specific resource (`scope_type` + `scope_id`).
 * The evaluator updates `last_state` ("firing"/"ok"/"pending") and
 * `last_value` on each tick.
 */
export interface AlertRule {
  id: string;
  team_id: string;
  scope_type: AlertScopeType;
  scope_id: string;
  name: string;
  metric_name: string;
  comparison: string;
  threshold: number;
  duration_seconds: number;
  severity: string;
  enabled: boolean;
  notification_channels: string[];
  last_state: string;
  last_value: number | null;
  last_evaluated_at: string | null;
  state_changed_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * One sample on the observability time series. Returned both by the latest-
 * per-metric endpoint and by the range query.
 */
export interface MetricSample {
  id?: number;
  scope_type: string;
  scope_id: string;
  metric_name: string;
  value: number;
  labels?: unknown;
  sampled_at: string;
}

export type MetricRange = "5m" | "1h" | "24h" | "7d" | "30d";

/** Audit row written when an alert transitions state. */
export interface AlertEvent {
  id: string;
  rule_id: string;
  team_id: string;
  scope_type: string;
  scope_id: string;
  state: string;
  metric_value: number | null;
  threshold: number;
  message: string;
  notified_at: string | null;
  created_at: string;
}

/**
 * The Go API returns audit logs as a plain array. Pagination is via the
 * `before=<RFC3339>` query parameter using the last entry's `created_at`.
 */
export type AuditLogList = AuditLog[];

/**
 * Active container running an app's current deployment. Returned by
 * GET /apps/{id}/replicas — joined with deployment_targets + servers.
 */
export interface Replica {
  target_id: string;
  container_id: string | null;
  server_id: string;
  server_name: string;
  agent_id: string | null;
}

/** Scheduler placement strategies — mirrors internal/scheduler/scheduler.go. */
export type PlacementStrategy = "spread" | "binpack" | "pinned" | string;

/**
 * Label-based placement constraints. Each map is server-tag key→value;
 * must_have requires the tag to be present, must_not_have excludes it.
 */
export interface PlacementConstraints {
  must_have: Record<string, string>;
  must_not_have: Record<string, string>;
}

/**
 * One entry in an app's scaling-event log. Records replica/strategy changes
 * (manual or autoscaler-driven) with optional metric context.
 */
export interface ScalingEvent {
  id: string;
  app_id: string;
  environment_id: string | null;
  deployment_id: string | null;
  actor_id: string | null;
  actor_type: string;
  event_type: string;
  from_replicas: number;
  to_replicas: number;
  placement_strategy: string;
  metric_name?: string | null;
  metric_value?: number | null;
  rule_name?: string | null;
  message: string;
  metadata?: unknown;
  created_at: string;
}

/** Result of POST /apps/{id}/scale — the updated app, event row, and optional fresh deployment. */
export interface ScaleResult {
  app: App;
  event: ScalingEvent;
  deployment?: Deployment | null;
}

/**
 * Response of POST /apps/{id}/domain/verify. The Go API attempts DNS lookup
 * and returns the resolved CNAME or A-record target it accepted (empty when
 * verified=false).
 */
export interface VerifyDomainResult {
  domain: string;
  verified: boolean;
  target: string;
}

/**
 * A single traffic route belonging to an app's environment. The route binds
 * a domain to one or more deployment backends, each with a relative weight.
 * Mode is the high-level shape ("simple", "canary", "blue_green").
 */
export interface TrafficRoute {
  id: string;
  app_id: string;
  environment_id: string;
  domain: string;
  mode: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * A backend points the route at a specific deployment. The shape from
 * GET /apps/{id}/traffic is the join row with deployment metadata.
 */
export interface TrafficBackend {
  id: string;
  route_id: string;
  deployment_id: string;
  label: string;
  weight: number;
  status: string;
  created_at: string;
  updated_at: string;
  deployment_status: string;
  replicas_ready: number;
  replicas_desired: number;
  commit_sha: string;
  image_tag: string;
}

export interface TrafficEvent {
  id: string;
  route_id: string;
  actor_id: string | null;
  actor_type: string;
  event_type: string;
  message: string;
  metadata?: unknown;
  created_at: string;
}

/** Aggregate view returned by GET /apps/{id}/traffic. `route` is null when no route has been created yet. */
export interface TrafficView {
  route: TrafficRoute | null;
  backends: TrafficBackend[];
  events: TrafficEvent[];
}

/** Comparison operator on an autoscaling rule's metric threshold. */
export type AutoscaleComparison = "gt" | "gte" | "lt" | "lte" | "eq" | "ne" | string;

/** What an autoscaling rule does when its condition is met. */
export type AutoscaleActionType = "scale_by" | "scale_to" | string;

/**
 * Declarative autoscaling rule attached to an app. When a metric (`metric_name`)
 * compares true against `threshold` for `duration_seconds`, the rule fires the
 * configured action — bounded by min/max replicas and the cooldown windows.
 */
export interface AutoscalingRule {
  id: string;
  app_id: string;
  name: string;
  metric_name: string;
  comparison: AutoscaleComparison;
  threshold: number;
  duration_seconds: number;
  action_type: AutoscaleActionType;
  action_value: number;
  min_replicas: number;
  max_replicas: number;
  cooldown_up_seconds: number;
  cooldown_down_seconds: number;
  enabled: boolean;
  last_triggered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Result of an explicit POST /apps/{id}/autoscaling/evaluate call. The handler
 * returns one entry per rule, with `triggered` set when the action fired
 * (in which case `event` references the recorded ScalingEvent).
 */
export interface AutoscaleEvaluation {
  rule_id: string;
  rule_name: string;
  metric_name: string;
  metric_value: number;
  triggered: boolean;
  message: string;
  event?: ScalingEvent | null;
}

/**
 * Team-scoped encrypted secret. The plaintext value is never returned
 * by list/get — call /reveal once to obtain it. `revealed_at` records the
 * one-time disclosure timestamp.
 */
export interface Secret {
  id: string;
  team_id: string;
  environment: string;
  key: string;
  version: number;
  revealed_at?: string | null;
  created_at: string;
  updated_at: string;
}
