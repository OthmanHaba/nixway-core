# Phase 0: Foundation — Design Spec

**Project:** Nixway PaaS Platform
**Phase:** 0 — Foundation
**Date:** 2026-04-19
**Module path:** `github.com/othmanhaba/nixway-core`

---

## Overview

Phase 0 establishes the core platform infrastructure: control plane API, data layer, job system, agent binary with mTLS, CLI tool, web UI skeleton, full auth system (signup, login, password reset, sessions), teams with invites and RBAC, API tokens with scopes, and an audit log subsystem.

Every component is fully implemented, tested, and verified against the exit criteria defined in the project spec.

---

## Project Structure

```
nixway-core/
├── cmd/
│   ├── api/              # Control plane API server
│   ├── worker/           # Job queue worker
│   ├── agent/            # Agent binary
│   └── cli/              # CLI tool (nxw)
├── internal/
│   ├── api/              # HTTP handlers, middleware, routes
│   │   ├── handler/      # Grouped by domain (auth, team, token, audit)
│   │   └── middleware/   # Auth, logging, rate limiting, RBAC
│   ├── auth/             # JWT, sessions, password hashing, RBAC
│   ├── config/           # App config (Viper)
│   ├── db/               # DB connection, sqlc generated code
│   ├── email/            # Email sender interface + console/SMTP impls
│   ├── job/              # River job definitions + handlers
│   ├── model/            # Domain types shared across layers
│   ├── agent/            # Agent protocol, mTLS, connection manager
│   └── audit/            # Audit log writer
├── sql/
│   ├── migrations/       # Goose migration files
│   └── queries/          # sqlc query files
├── proto/                # Protobuf definitions for agent protocol
├── web/                  # Vite + React 19 frontend
├── docker-compose.yml    # Postgres + Redis for local dev
├── Makefile
├── go.mod
└── go.sum
```

---

## 1. Control Plane API (`cmd/api`)

### Framework
- Go `net/http` REST server
- OpenAPI 3.1 spec in `api/openapi.yaml`
- `oapi-codegen` generates server interfaces and request/response types
- Structured logging via `slog`
- OpenTelemetry tracing on all endpoints

### Route Groups
- `POST /api/v1/auth/signup` — register new user
- `POST /api/v1/auth/login` — authenticate, return session cookie
- `POST /api/v1/auth/logout` — destroy session
- `POST /api/v1/auth/verify-email` — verify email with token
- `POST /api/v1/auth/forgot-password` — send reset email
- `POST /api/v1/auth/reset-password` — reset password with token
- `GET /api/v1/auth/me` — current user profile
- `POST /api/v1/teams` — create team
- `GET /api/v1/teams` — list user's teams
- `GET /api/v1/teams/:id` — team detail
- `PUT /api/v1/teams/:id` — update team
- `DELETE /api/v1/teams/:id` — delete team (owner only)
- `POST /api/v1/teams/:id/invites` — invite user by email
- `GET /api/v1/teams/:id/invites` — list pending invites
- `DELETE /api/v1/teams/:id/invites/:inviteId` — cancel invite
- `POST /api/v1/invites/:token/accept` — accept invite
- `GET /api/v1/teams/:id/members` — list members
- `PUT /api/v1/teams/:id/members/:userId` — change role
- `DELETE /api/v1/teams/:id/members/:userId` — remove member
- `POST /api/v1/teams/:id/tokens` — create API token
- `GET /api/v1/teams/:id/tokens` — list tokens (metadata only)
- `DELETE /api/v1/teams/:id/tokens/:tokenId` — revoke token
- `GET /api/v1/teams/:id/audit-logs` — query audit logs

### Middleware Chain
`request_id → slog_logger → recover → cors → auth → rbac`

### Server Lifecycle
- Graceful shutdown on SIGINT/SIGTERM
- Context cancellation propagated to all handlers
- Configurable listen address and port

---

## 2. Data Layer

### PostgreSQL 16
- Driver: `pgx/v5` with connection pooling (`pgxpool`)
- Migrations: `goose` with SQL files in `sql/migrations/`
- Queries: `sqlc` with query files in `sql/queries/`

### Database Schema

**`users`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| email | TEXT | UNIQUE, NOT NULL |
| password_hash | TEXT | NOT NULL, bcrypt |
| name | TEXT | NOT NULL |
| email_verified | BOOLEAN | DEFAULT false |
| email_verify_token | TEXT | nullable |
| email_verify_expires | TIMESTAMPTZ | nullable |
| password_reset_token | TEXT | nullable |
| password_reset_expires | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

**`teams`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| name | TEXT | NOT NULL |
| slug | TEXT | UNIQUE, NOT NULL |
| created_at | TIMESTAMPTZ | |
| updated_at | TIMESTAMPTZ | |

**`team_memberships`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| team_id | UUID | FK → teams |
| user_id | UUID | FK → users |
| role | TEXT | 'owner', 'admin', 'member' |
| created_at | TIMESTAMPTZ | |
| UNIQUE(team_id, user_id) | | |

**`team_invites`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| team_id | UUID | FK → teams |
| email | TEXT | NOT NULL |
| role | TEXT | 'admin', 'member' |
| token | TEXT | UNIQUE, NOT NULL |
| invited_by | UUID | FK → users |
| expires_at | TIMESTAMPTZ | NOT NULL |
| created_at | TIMESTAMPTZ | |

**`api_tokens`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| team_id | UUID | FK → teams |
| user_id | UUID | FK → users (creator) |
| name | TEXT | NOT NULL |
| token_hash | TEXT | NOT NULL (SHA-256 of JWT) |
| scopes | TEXT[] | e.g. {'read','write','admin'} |
| last_used_at | TIMESTAMPTZ | nullable |
| expires_at | TIMESTAMPTZ | nullable |
| revoked_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | |

**`audit_logs`**
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| team_id | UUID | FK → teams |
| actor_id | UUID | nullable (system actions) |
| actor_type | TEXT | 'user', 'token', 'system' |
| action | TEXT | e.g. 'user.login', 'team.create' |
| resource_type | TEXT | e.g. 'team', 'user', 'token' |
| resource_id | UUID | nullable |
| metadata | JSONB | additional context |
| ip_address | INET | |
| created_at | TIMESTAMPTZ | DEFAULT now() |

**Indexes on `audit_logs`:**
- `(team_id, created_at DESC)`
- `(actor_id, created_at DESC)`
- `(resource_type, resource_id)`
- `(action)`

### Redis 7
- Driver: `go-redis/v9`
- Used for:
  - **Web sessions**: key = `session:<session_id>`, value = JSON user data, TTL = 24h
  - **JWT blocklist**: key = `blocklist:<token_hash>`, TTL = remaining token lifetime
  - **Rate limit counters**: key = `ratelimit:<ip>:<endpoint>`, INCR with TTL

---

## 3. Auth System

### Signup Flow
1. User submits email + password + name
2. Validate email format, password strength (min 8 chars)
3. Hash password with bcrypt (cost 12)
4. Insert user with `email_verified=false`
5. Generate verification token (crypto/rand, 32 bytes, base64url)
6. Store token + expiry (24h) on user record
7. Enqueue `send_email` job with verification link
8. Return 201 with user (minus sensitive fields)

### Email Verification
1. User clicks link with token
2. Look up user by token, check expiry
3. Set `email_verified=true`, clear token
4. Return success

### Login Flow
1. User submits email + password
2. Look up user by email
3. Compare bcrypt hash
4. Require `email_verified=true`
5. Generate session ID (crypto/rand, 32 bytes)
6. Store session in Redis with user data, 24h TTL
7. Set HttpOnly, Secure, SameSite=Lax cookie with session ID
8. Write audit log entry
9. Return user profile

### Logout
1. Delete session from Redis
2. Clear cookie
3. Write audit log

### Password Reset
1. User submits email
2. Generate reset token, store with 1h expiry
3. Enqueue email job
4. On reset: validate token + expiry, hash new password, update user, invalidate all sessions for user
5. Write audit log

### API Token Auth
1. Token sent via `Authorization: Bearer <jwt>`
2. Verify JWT signature (HMAC-SHA256)
3. Check token hash against `api_tokens` table — reject if revoked or expired
4. Extract scopes, attach to request context
5. Update `last_used_at`

### Web Session Auth
1. Session cookie sent with request
2. Look up session in Redis by session ID
3. If missing/expired → 401
4. Attach user data to request context

### RBAC
- Roles: `owner` > `admin` > `member`
- Owner: all operations including delete team, manage billing
- Admin: invite/remove members, manage tokens, manage resources
- Member: read access, deploy (in later phases)
- Enforced in middleware per-route with role requirements

---

## 4. Teams

### Create Team
- User provides name → auto-generate slug from name
- Creator becomes `owner`
- Write audit log

### Invite Flow
1. Owner/admin invites by email + role
2. Generate invite token (crypto/rand), set 7-day expiry
3. Enqueue invite email job
4. If invitee has account → they accept via API
5. If invitee has no account → they sign up, then accept
6. On accept: create membership, delete invite, write audit log

### Membership Management
- List members with roles
- Change role (owner/admin only, cannot demote last owner)
- Remove member (owner/admin only, cannot remove last owner)
- Leave team (member removes self, unless last owner)

---

## 5. Job Queue + Workers (`cmd/worker`)

### Engine
- **River** on PostgreSQL — jobs are transactional with app data
- Worker runs as separate binary (`cmd/worker`)

### Job Types (Phase 0)
| Job | Description | Retry | Priority |
|-----|-------------|-------|----------|
| `send_email` | Send email via configured sender | 3x exponential | normal |
| `cleanup_expired_sessions` | Purge expired Redis sessions | 1x | low |
| `cleanup_expired_invites` | Delete expired team invites | 1x | low |

### Features
- Exponential backoff: base 5s, multiplier 2x
- Dead letter queue: failed jobs moved after max retries
- Scheduled jobs: cleanup jobs run on cron (every 1h)
- Distributed locks via River's advisory locks
- Job priority levels: low, normal, high, critical

---

## 6. Agent Binary (`cmd/agent`)

### Build
- Single static Go binary
- Cross-compiled: `linux/amd64`, `linux/arm64`
- Target size: <20MB (stripped, no CGO)

### mTLS
- Control plane runs a `smallstep/step-ca` instance as CA
- On registration: agent generates keypair, sends CSR to control plane, receives signed cert
- All gRPC connections use mTLS — agent authenticates control plane, control plane authenticates agent
- Cert rotation: agent requests new cert before expiry (at 70% lifetime)

### Protocol (gRPC bidirectional stream)
Protobuf definitions in `proto/agent/v1/agent.proto`:

```protobuf
service AgentService {
  rpc Connect(stream AgentMessage) returns (stream ControlMessage);
  rpc Register(RegisterRequest) returns (RegisterResponse);
}

message AgentMessage {
  oneof payload {
    Heartbeat heartbeat = 1;
    ExecOutput exec_output = 2;
    HealthReport health_report = 3;
    FileChunk file_chunk = 4;
  }
}

message ControlMessage {
  oneof payload {
    ExecCommand exec_command = 1;
    FileTransferRequest file_transfer = 2;
    CertRotation cert_rotation = 3;
  }
}

message Heartbeat {
  string agent_id = 1;
  google.protobuf.Timestamp timestamp = 2;
}

message ExecCommand {
  string command_id = 1;
  string command = 2;
  repeated string args = 3;
  map<string, string> env = 4;
  string working_dir = 5;
}

message ExecOutput {
  string command_id = 1;
  bytes stdout = 2;
  bytes stderr = 3;
  bool finished = 4;
  int32 exit_code = 5;
}

message HealthReport {
  string agent_id = 1;
  double cpu_percent = 2;
  uint64 memory_total = 3;
  uint64 memory_used = 4;
  repeated DiskInfo disks = 5;
}
```

### Connection Behavior
- Persistent gRPC stream with keepalive pings (10s interval)
- On disconnect: exponential backoff reconnect (1s → 2s → 4s → ... max 30s)
- Reconnects within 10 seconds under normal conditions
- Agent stores its ID + cert locally in `/etc/nixway/` 

---

## 7. CLI Tool (`cmd/cli`)

### Framework
- Cobra for command structure
- Viper for config file (`~/.nixway/config.yaml`)

### Commands
```
nxw login                          # Interactive login, stores session
nxw logout                         # Clear stored session
nxw teams list                     # List teams
nxw teams create <name>            # Create team
nxw teams members <team>           # List team members
nxw tokens create <team> <name>    # Create API token
nxw tokens list <team>             # List tokens
nxw tokens revoke <team> <id>      # Revoke token
```

### Auth Storage
- API token stored via `go-keyring` (OS keychain on macOS/Linux)
- Fallback to encrypted file if keychain unavailable
- Config file stores: API base URL, default team

---

## 8. Web UI (`web/`)

### Stack
- Vite + React 19 + TypeScript
- TanStack Router (file-based routing)
- TanStack Query (data fetching + caching)
- TanStack Table (data grids)
- Tailwind CSS + shadcn/ui components

### Pages (Phase 0)
| Route | Page | Auth |
|-------|------|------|
| `/login` | Login form | public |
| `/signup` | Signup form | public |
| `/verify-email/:token` | Email verification | public |
| `/forgot-password` | Request reset | public |
| `/reset-password/:token` | Reset form | public |
| `/dashboard` | Empty dashboard shell | protected |
| `/teams` | Team list | protected |
| `/teams/:id` | Team detail + members | protected |
| `/teams/:id/settings` | Team settings + invites | protected |
| `/teams/:id/tokens` | API token management | protected |
| `/teams/:id/audit-log` | Audit log viewer | protected |

### Auth State
- Session cookie set by API
- TanStack Query fetches `/api/v1/auth/me` on app load
- Protected routes redirect to `/login` if unauthenticated
- Login/logout trigger query cache invalidation

---

## 9. Audit Log

### Design
- Append-only `audit_logs` table (no updates, no deletes)
- Written by a dedicated `AuditWriter` service injected into handlers
- Every mutating API call produces an audit entry

### Actions Tracked
| Action | Resource | Trigger |
|--------|----------|---------|
| `user.signup` | user | signup |
| `user.login` | user | login |
| `user.logout` | user | logout |
| `user.verify_email` | user | email verification |
| `user.reset_password` | user | password reset |
| `team.create` | team | team creation |
| `team.update` | team | team update |
| `team.delete` | team | team deletion |
| `team.invite.create` | invite | invite sent |
| `team.invite.accept` | invite | invite accepted |
| `team.invite.cancel` | invite | invite cancelled |
| `team.member.update_role` | membership | role change |
| `team.member.remove` | membership | member removed |
| `token.create` | token | token created |
| `token.revoke` | token | token revoked |

### Query API
- Filter by: actor, action, resource_type, resource_id, time range
- Pagination: cursor-based (by `created_at` + `id`)
- Response includes actor name resolution (join with users)

---

## 10. Email System

### Interface
```go
type EmailSender interface {
    Send(ctx context.Context, to, subject, htmlBody, textBody string) error
}
```

### Implementations
- **ConsoleSender**: prints email to stdout with slog (dev mode)
- **SMTPSender**: sends via SMTP with TLS (prod mode)

### Selection
- Config key `email.driver`: `console` (default) or `smtp`
- SMTP config: `email.smtp.host`, `email.smtp.port`, `email.smtp.username`, `email.smtp.password`, `email.smtp.from`

---

## 11. Local Dev Environment

### docker-compose.yml
- PostgreSQL 16 on port 5432
- Redis 7 on port 6379
- step-ca on port 9000 (agent CA)

### Makefile Targets
- `make dev` — start docker-compose, run API + worker
- `make migrate` — run goose migrations
- `make generate` — run sqlc + oapi-codegen + protoc
- `make test` — run all Go tests
- `make test-integration` — run integration tests with testcontainers
- `make build-agent` — cross-compile agent binary
- `make lint` — run golangci-lint
- `make web` — start Vite dev server

---

## 12. Testing Strategy

### Unit Tests
- All business logic in `internal/` packages
- Table-driven tests with `testify`
- Mock interfaces for DB, Redis, email sender

### Integration Tests
- `testcontainers-go` spins up real PostgreSQL + Redis
- Test full auth flows: signup → verify → login → create team → invite → accept
- Test job processing: enqueue → worker picks up → completes
- Test agent connect/disconnect cycle
- Test audit log writes with correct attribution

### Exit Criteria Tests
Specific tests validating each "Done When" item from the spec:
1. User signs up, verifies email, logs in, creates team, invites user, user accepts
2. Job enqueued from API is picked up by worker, runs, reports completion
3. Agent registers with control plane, heartbeat flows every 10 seconds
4. Control plane sends exec command to agent; stdout streams back in real time
5. Killing and restarting agent reconnects within 10 seconds
6. CLI can log in and list teams
7. Revoking an API token invalidates it immediately
8. Audit log records all of the above with correct actor attribution

---

## Tech Stack Summary (Phase 0)

| Layer | Technology |
|-------|-----------|
| Language (backend) | Go |
| Language (frontend) | TypeScript |
| API framework | Go net/http + OpenAPI + oapi-codegen |
| Agent protocol | gRPC + Protocol Buffers |
| Database | PostgreSQL 16 + pgx/v5 + sqlc + goose |
| Job queue | River (on PostgreSQL) |
| Cache/sessions | Redis 7 + go-redis/v9 |
| mTLS CA | smallstep/step-ca |
| CLI | Cobra + Viper + go-keyring |
| Frontend | Vite + React 19 + TanStack (Router, Query, Table) + Tailwind + shadcn/ui |
| Testing | testify + testcontainers-go |
| Logging | slog |
| Tracing | OpenTelemetry |
| Linting | golangci-lint, ESLint + Biome |
