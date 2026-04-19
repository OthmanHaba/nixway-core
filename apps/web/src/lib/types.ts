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
