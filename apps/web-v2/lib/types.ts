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
}

export interface Database {
  id: string;
  team_id: string;
  project_id: string;
  cluster_id: string | null;
  server_id: string | null;
  template_slug: string;
  version: string;
  name: string;
  status: string;
  created_at: string;
  updated_at: string;
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
