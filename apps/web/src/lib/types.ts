export interface User {
  id: string
  email: string
  name: string
  email_verified: boolean
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  slug: string
  created_at: string
  updated_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: string
  email: string
  user_name: string
  created_at: string
}

export interface TeamInvite {
  id: string
  team_id: string
  email: string
  role: string
  inviter_name: string
  expires_at: string
  created_at: string
}

export interface APIToken {
  id: string
  team_id: string
  user_id: string
  name: string
  scopes: string[]
  last_used_at: string | null
  expires_at: string | null
  created_at: string
  token?: string
}

export interface AuditLog {
  id: string
  team_id: string
  actor_id: string | null
  actor_type: string
  actor_name: string | null
  actor_email: string | null
  action: string
  resource_type: string
  resource_id: string | null
  metadata: Record<string, unknown>
  ip_address: string
  created_at: string
}

export interface SSHKey {
  id: string
  team_id: string
  name: string
  public_key: string
  key_type: string
  fingerprint: string
  created_at: string
  updated_at: string
}

export interface Server {
  id: string
  team_id: string
  agent_id: string | null
  name: string
  hostname: string
  public_ip: string
  ssh_port: number
  ssh_user: string
  os: string | null
  os_version: string | null
  arch: string | null
  status: string
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface ServerTag {
  id: string
  server_id: string
  key: string
  value: string
}

export interface ServerResources {
  server_id: string
  cpu_model: string
  cpu_cores: number
  memory_total: number
  memory_available: number
  kernel_version: string
  docker_version: string | null
  disks: { mount_point: string; total_bytes: number; used_bytes: number }[]
  network_interfaces: { name: string; ips: string[] }[]
  updated_at: string
}

export interface ProvisioningJob {
  id: string
  server_id: string
  components: string[]
  status: string
  logs: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
}

export interface BuilderCandidate {
  builder: string
  confidence: number
  reason: string
}

export interface Cluster {
  id: string
  team_id: string
  name: string
  slug: string
  description: string
  region: string
  cidr: string
  status: string
  created_at: string
  updated_at: string
}

export interface ClusterDetail extends Cluster {
  member_count: number
}

export interface ClusterMember {
  id: string
  cluster_id: string
  server_id: string
  wireguard_ip: string
  wireguard_public_key: string
  wireguard_endpoint: string
  listen_port: number
  joined_at: string
  server_name: string
  public_ip: string
  server_status: string
}

export interface WireGuardPeer {
  id: string
  member_id: string
  peer_member_id: string
  status: string
  last_handshake_at: string | null
  last_check_at: string | null
  rtt_ms: number | null
  from_ip: string
  from_server_name: string
  to_ip: string
  to_server_name: string
}

export interface MeshEvent {
  id: string
  cluster_id: string
  event_type: string
  member_id: string | null
  details: Record<string, unknown> | null
  created_at: string
}

export interface GitHubApp {
  id: string
  team_id: string
  app_id: number
  app_name: string
  app_slug: string
  client_id: string
  html_url: string
  created_at: string
  updated_at: string
}

export interface GitHubInstallation {
  id: string
  github_app_id: string
  installation_id: number
  account_login: string
  account_type: string
  target_type: string
  suspended_at: string | null
  created_at: string
  updated_at: string
}

export interface GitHubRepository {
  id: number
  name: string
  full_name: string
  private: boolean
  default_branch: string
  clone_url: string
}

export interface RegistryCredential {
  id: string
  team_id: string
  name: string
  registry_type: string
  registry_url: string
  username: string
  region: string | null
  validated_at: string | null
  created_at: string
  updated_at: string
}

export interface Secret {
  id: string
  team_id: string
  environment: string
  key: string
  version: number
  revealed_at: string | null
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  team_id: string
  cluster_id: string
  name: string
  slug: string
  description: string
  status: string
  created_at: string
  updated_at: string
  cluster_name?: string
}

export interface Environment {
  id: string
  project_id: string
  name: string
  slug: string
  is_production: boolean
  created_at: string
}

export interface App {
  id: string
  project_id: string
  name: string
  slug: string
  source_type: 'github' | 'docker_image'
  github_installation_id: string | null
  repo_full_name: string | null
  branch: string | null
  root_path: string
  auto_deploy: boolean
  docker_image: string | null
  registry_credential_id: string | null
  builder: string
  dockerfile_path: string
  port: number
  health_check_path: string
  health_check_interval: number
  health_check_timeout: number
  replicas: number
  subdomain: string | null
  custom_domain: string | null
  domain_verified: boolean
  status: string
  created_at: string
  updated_at: string
}

export interface Build {
  id: string
  app_id: string
  environment_id: string
  trigger_type: 'push' | 'manual' | 'rollback'
  commit_sha: string
  commit_message: string
  branch: string
  builder: string
  image_tag: string
  server_id: string | null
  status: 'pending' | 'cloning' | 'building' | 'built' | 'failed' | 'cancelled'
  logs: string
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
}

export interface Deployment {
  id: string
  app_id: string
  environment_id: string
  build_id: string
  strategy: string
  replicas_desired: number
  replicas_ready: number
  logs: string
  platform_domain: string
  status: 'pending' | 'deploying' | 'healthy' | 'degraded' | 'failed' | 'rolled_back'
  started_at: string | null
  completed_at: string | null
  error: string | null
  created_at: string
  commit_sha?: string
  commit_message?: string
  image_tag?: string
}

export interface DeploymentTarget {
  id: string
  deployment_id: string
  server_id: string
  container_id: string | null
  status: string
  health_check_attempts: number
  started_at: string | null
  healthy_at: string | null
  stopped_at: string | null
  error: string | null
  server_name?: string
  public_ip?: string
}
