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
  metadata: unknown
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

export interface MetricSample {
  id: number
  scope_type: string
  scope_id: string
  metric_name: string
  value: number
  labels: string | Record<string, unknown>
  sampled_at: string
}

export interface AlertRule {
  id: string
  team_id: string
  scope_type: string
  scope_id: string
  name: string
  metric_name: string
  comparison: string
  threshold: number
  duration_seconds: number
  severity: string
  enabled: boolean
  notification_channels: string[]
  last_state: string
  last_value: number | null
  last_evaluated_at: string | null
  state_changed_at: string | null
  created_at: string
  updated_at: string
}

export interface AlertEvent {
  id: string
  rule_id: string
  team_id: string
  scope_type: string
  scope_id: string
  state: string
  metric_value: number | null
  threshold: number
  message: string
  notified_at: string | null
  created_at: string
}

export interface NotificationChannel {
  id: string
  team_id: string
  name: string
  type: string
  target: string
  enabled: boolean
  created_at: string
  updated_at: string
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
  placement_strategy: 'spread' | 'binpack' | 'pinned'
  placement_constraints: {
    must_have?: Record<string, string>
    must_not_have?: Record<string, string>
  }
  pinned_server_ids: string[]
  subdomain: string | null
  custom_domain: string | null
  domain_verified: boolean
  memory_limit_mb: number
  cpu_limit_millicores: number
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

export interface ContainerReplica {
  target_id: string
  container_id: string | null
  server_id: string
  server_name: string
  agent_id: string | null
}

export interface ScalingEvent {
  id: string
  app_id: string
  environment_id: string | null
  deployment_id: string | null
  actor_id: string | null
  actor_type: string
  event_type: string
  from_replicas: number
  to_replicas: number
  placement_strategy: string
  metric_name: string | null
  metric_value: number | null
  rule_name: string | null
  message: string
  metadata: Record<string, unknown>
  created_at: string
}

export interface AutoscalingRule {
  id: string
  app_id: string
  name: string
  metric_name: string
  comparison: 'gt' | 'gte' | 'lt' | 'lte'
  threshold: number
  duration_seconds: number
  action_type: 'scale_by' | 'scale_to'
  action_value: number
  min_replicas: number
  max_replicas: number
  cooldown_up_seconds: number
  cooldown_down_seconds: number
  enabled: boolean
  last_triggered_at: string | null
  created_at: string
  updated_at: string
}

export interface AutoscaleEvaluation {
  rule_id: string
  rule_name: string
  metric_name: string
  metric_value: number
  triggered: boolean
  message: string
  event?: ScalingEvent
}

export interface TrafficRoute {
  id: string
  app_id: string
  environment_id: string
  domain: string
  mode: string
  status: string
  created_at: string
  updated_at: string
}

export interface TrafficBackend {
  id: string
  route_id: string
  deployment_id: string
  label: string
  weight: number
  status: string
  deployment_status: string
  replicas_ready: number
  replicas_desired: number
  commit_sha: string
  image_tag: string
  created_at: string
  updated_at: string
}

export interface TrafficEvent {
  id: string
  route_id: string
  actor_id: string | null
  actor_type: string
  event_type: string
  message: string
  metadata: unknown
  created_at: string
}

export interface TrafficView {
  route?: TrafficRoute
  backends: TrafficBackend[]
  events: TrafficEvent[]
}

export interface ContainerInspect {
  request_id: string
  container_name: string
  status: string
  image: string
  created_at: string
  started_at: string
  memory_limit: number
  memory_usage: number
  cpu_percent: number
  pid: number
  env: Record<string, string>
  labels: Record<string, string>
  ports: string[]
  network_ip: string
  restart_count: number
  success: boolean
  error: string
}

export interface ContainerLogEntry {
  id: number
  app_id: string
  server_id: string
  container_name: string
  replica_index: number
  line: string
  stream: string
  logged_at: string
}

export interface TerminalSession {
  id: string
  team_id: string
  user_id: string
  app_id: string | null
  server_id: string
  container_name: string | null
  replica_index: number | null
  session_type: 'ssh' | 'container_exec'
  started_at: string
  ended_at: string | null
  duration_seconds: number | null
}

export interface Volume {
  id: string
  team_id: string
  cluster_id: string
  server_id: string
  name: string
  size_gb: number
  used_bytes: number
  filesystem: string
  mount_path: string | null
  container_name: string | null
  status: string
  host_path: string
  created_at: string
  updated_at: string
}

export interface VolumeSnapshot {
  id: string
  volume_id: string
  size_bytes: number
  storage_type: string
  storage_path: string
  created_at: string
}

export interface ServiceTemplateSummary {
  slug: string
  name: string
  category: string
  description?: string
  ports: number[]
  default_resources: { milli_cpu: number; memory_mb: number }
  volume_spec: { mount_path: string; default_gib?: number }
  credential_policy: string
  version_count: number
}

export interface ServiceTemplateVersion {
  version: string
  image: string
  default?: boolean
}

export interface ServiceTemplateDetail extends ServiceTemplateSummary {
  versions: ServiceTemplateVersion[]
  health_check: { command: string; interval?: number; timeout?: number; retries?: number }
  conn_string_fmt: string
  env_template: Record<string, string>
  shell_command: string
  command?: string
}

export interface Database {
  id: string
  team_id: string
  project_id: string
  cluster_id: string
  server_id: string
  volume_id: string | null
  template_slug: string
  version: string
  name: string
  container_name: string
  status: string
  port: number
  dns_record: string | null
  superuser_secret_id: string | null
  appuser_secret_id: string | null
  resource_cpu_millicores: number
  resource_memory_mb: number
  backup_schedule: string | null
  backup_retention_days: number | null
  backup_storage_type: string | null
  created_at: string
  updated_at: string
}

export interface DatabaseProvisionResult {
  database: Database
  superuser_password: string
  appuser_password: string
}

// --- Database tooling (Phase 8.6) ---

export interface SchemaList {
  schemas: string[]
}

export interface TableInfo {
  name: string
  row_count: number
}

export interface TableList {
  tables: TableInfo[]
}

export interface QueryColumn {
  name: string
  type_name?: string
}

export interface QueryRow {
  values: string[]
  nulls: boolean[]
}

export interface RowPage {
  columns: QueryColumn[]
  rows: QueryRow[]
  page: number
  limit: number
  total: number
}

export interface QueryResult {
  success: boolean
  error?: string
  execution_time_ms: number
  columns?: QueryColumn[]
  rows?: QueryRow[]
  affected_rows?: number
  raw_text?: string
  query_history_id: string
  truncated?: boolean
}

export interface QueryHistoryEntry {
  id: string
  user_id: string
  database_id: string
  query_text: string
  write_mode: boolean
  execution_time_ms: number | null
  row_count: number | null
  error: string | null
  created_at: string
}

export interface SavedQuery {
  id: string
  project_id: string
  user_id: string
  database_id: { Bytes?: string; Valid: boolean } | null
  name: string
  query_text: string
  created_at: string
  updated_at: string
}

export interface DatabaseLink {
  id: string
  database_id: string
  app_id: string
  env_prefix: string
  created_at: string
}
