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
