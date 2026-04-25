package model

import (
	"net/netip"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID            uuid.UUID `json:"id"`
	Email         string    `json:"email"`
	Name          string    `json:"name"`
	EmailVerified bool      `json:"email_verified"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
}

type Team struct {
	ID        uuid.UUID `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type TeamMember struct {
	ID        uuid.UUID `json:"id"`
	TeamID    uuid.UUID `json:"team_id"`
	UserID    uuid.UUID `json:"user_id"`
	Role      string    `json:"role"`
	Email     string    `json:"email"`
	UserName  string    `json:"user_name"`
	CreatedAt time.Time `json:"created_at"`
}

type TeamInvite struct {
	ID          uuid.UUID `json:"id"`
	TeamID      uuid.UUID `json:"team_id"`
	Email       string    `json:"email"`
	Role        string    `json:"role"`
	InviterName string    `json:"inviter_name"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type APIToken struct {
	ID         uuid.UUID  `json:"id"`
	TeamID     uuid.UUID  `json:"team_id"`
	UserID     uuid.UUID  `json:"user_id"`
	Name       string     `json:"name"`
	Scopes     []string   `json:"scopes"`
	LastUsedAt *time.Time `json:"last_used_at"`
	ExpiresAt  *time.Time `json:"expires_at"`
	CreatedAt  time.Time  `json:"created_at"`
}

type APITokenWithPlain struct {
	APIToken
	PlainToken string `json:"token"`
}

const (
	ScopeAll          = "*"
	ScopeTeamsRead    = "teams:read"
	ScopeTeamsWrite   = "teams:write"
	ScopeMembersRead  = "members:read"
	ScopeMembersWrite = "members:write"
	ScopeInvitesRead  = "invites:read"
	ScopeInvitesWrite = "invites:write"
	ScopeTokensRead   = "tokens:read"
	ScopeTokensWrite  = "tokens:write"
	ScopeAuditRead    = "audit:read"
	ScopeServersRead  = "servers:read"
	ScopeServersWrite = "servers:write"
)

var validTokenScopes = map[string]struct{}{
	ScopeAll:          {},
	"teams:*":         {},
	"members:*":       {},
	"invites:*":       {},
	"tokens:*":        {},
	"audit:*":         {},
	"servers:*":       {},
	ScopeTeamsRead:    {},
	ScopeTeamsWrite:   {},
	ScopeMembersRead:  {},
	ScopeMembersWrite: {},
	ScopeInvitesRead:  {},
	ScopeInvitesWrite: {},
	ScopeTokensRead:   {},
	ScopeTokensWrite:  {},
	ScopeAuditRead:    {},
	ScopeServersRead:  {},
	ScopeServersWrite: {},
}

func ValidTokenScope(scope string) bool {
	_, ok := validTokenScopes[scope]
	return ok
}

type AuditLog struct {
	ID           uuid.UUID  `json:"id"`
	TeamID       *uuid.UUID `json:"team_id"`
	ActorID      *uuid.UUID `json:"actor_id"`
	ActorType    string     `json:"actor_type"`
	ActorName    *string    `json:"actor_name"`
	ActorEmail   *string    `json:"actor_email"`
	Action       string     `json:"action"`
	ResourceType string     `json:"resource_type"`
	ResourceID   *uuid.UUID `json:"resource_id"`
	Metadata     any        `json:"metadata"`
	IPAddress    netip.Addr `json:"ip_address"`
	CreatedAt    time.Time  `json:"created_at"`
}

type Role string

const (
	RoleOwner  Role = "owner"
	RoleAdmin  Role = "admin"
	RoleMember Role = "member"
)

func (r Role) AtLeast(required Role) bool {
	ranks := map[Role]int{RoleMember: 1, RoleAdmin: 2, RoleOwner: 3}
	return ranks[r] >= ranks[required]
}

// AuthContext is attached to requests by auth middleware
type AuthContext struct {
	UserID  uuid.UUID
	TeamID  *uuid.UUID
	Role    *Role
	TokenID *uuid.UUID
	Scopes  []string
}
