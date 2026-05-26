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

export interface Cluster {
  id: string;
  team_id: string;
  name: string;
  slug: string;
  description: string;
  region: string;
  cidr: string;
  status: "active" | "degraded" | "error";
  created_at: string;
  updated_at: string;
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
