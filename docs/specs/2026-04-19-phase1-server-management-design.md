# Phase 1: Server Management — Design Spec

**Project:** Nixway PaaS Platform
**Phase:** 1 — Server Management
**Date:** 2026-04-19
**Builds on:** Phase 0 (Foundation)

---

## Overview

Phase 1 adds server lifecycle management: SSH key management with encryption, server onboarding with agent auto-installation, heartbeat-driven status tracking, resource inventory collection, server tagging, a provisioning engine that pushes shell scripts to agents, and a repo auto-discovery engine for builder selection.

---

## New Database Tables

### `ssh_keys`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| team_id | UUID | FK → teams, NOT NULL |
| name | TEXT | NOT NULL |
| public_key | TEXT | NOT NULL |
| private_key_encrypted | BYTEA | NOT NULL (libsodium secretbox) |
| key_type | TEXT | NOT NULL, 'ed25519' or 'rsa' |
| fingerprint | TEXT | NOT NULL |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### `servers`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| team_id | UUID | FK → teams, NOT NULL |
| agent_id | TEXT | nullable, set after agent registers |
| name | TEXT | NOT NULL |
| hostname | TEXT | NOT NULL |
| public_ip | INET | NOT NULL |
| ssh_port | INT | NOT NULL DEFAULT 22 |
| ssh_user | TEXT | NOT NULL DEFAULT 'root' |
| os | TEXT | nullable (detected on connect) |
| os_version | TEXT | nullable |
| arch | TEXT | nullable |
| status | TEXT | NOT NULL DEFAULT 'provisioning' |
| last_seen_at | TIMESTAMPTZ | nullable |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

Status values: `provisioning`, `online`, `degraded`, `offline`

### `server_ssh_keys`
| Column | Type | Notes |
|--------|------|-------|
| server_id | UUID | FK → servers ON DELETE CASCADE |
| ssh_key_id | UUID | FK → ssh_keys ON DELETE CASCADE |
| PRIMARY KEY(server_id, ssh_key_id) | | |

### `server_tags`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| server_id | UUID | FK → servers ON DELETE CASCADE |
| key | TEXT | NOT NULL |
| value | TEXT | NOT NULL |
| UNIQUE(server_id, key) | | |

### `server_resources`
| Column | Type | Notes |
|--------|------|-------|
| server_id | UUID | PK, FK → servers ON DELETE CASCADE |
| cpu_model | TEXT | |
| cpu_cores | INT | |
| memory_total | BIGINT | bytes |
| memory_available | BIGINT | bytes |
| kernel_version | TEXT | |
| docker_version | TEXT | nullable |
| disks | JSONB | [{mount, total_bytes, used_bytes}] |
| network_interfaces | JSONB | [{name, ips}] |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

### `provisioning_jobs`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK |
| server_id | UUID | FK → servers, NOT NULL |
| components | TEXT[] | e.g. {'docker','traefik','nixpacks'} |
| status | TEXT | NOT NULL DEFAULT 'pending' |
| logs | TEXT | step-by-step logs, appended |
| started_at | TIMESTAMPTZ | nullable |
| completed_at | TIMESTAMPTZ | nullable |
| error | TEXT | nullable |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Status values: `pending`, `running`, `completed`, `failed`

---

## 1. SSH Key Management

### Encryption
- Private keys encrypted with libsodium secretbox (NaCl)
- Per-team encryption key derived from a platform master key using HKDF
- Master key loaded from environment variable `NIXWAY_MASTER_KEY` (32 bytes, hex-encoded)
- Fingerprint computed as SHA-256 of the public key, displayed in `SHA256:base64` format

### Key Generation
- Platform can generate ed25519 keys on behalf of the user
- User can also upload existing public+private key pairs
- RSA keys accepted (2048+ bits) but ed25519 preferred (flagged in UI)

### Key Rotation
1. Generate or upload new key
2. Attach new key to server (agent adds to `~/.ssh/authorized_keys`)
3. Verify new key works (agent attempts SSH loopback or control plane verifies)
4. Remove old key from server
5. Delete old key from platform

### API Endpoints
```
POST   /api/v1/teams/:id/ssh-keys              — create/generate key
GET    /api/v1/teams/:id/ssh-keys              — list keys (public only)
GET    /api/v1/teams/:id/ssh-keys/:keyId       — get key detail (no private)
DELETE /api/v1/teams/:id/ssh-keys/:keyId       — delete key
POST   /api/v1/teams/:id/ssh-keys/:keyId/rotate — rotate key on servers
```

---

## 2. Server Onboarding

### Flow
1. User submits: name, hostname/IP, SSH port (default 22), SSH user (default root), SSH key ID
2. Platform decrypts the private key for the selected SSH key
3. SSH connectivity check:
   - Connect via SSH using the key
   - Run `uname -a` to verify access
   - Run `df -h` for disk space check
   - Run `sudo -n true` to verify passwordless sudo
   - Read `/etc/os-release` for OS detection
4. Validate OS: Ubuntu 22.04, Ubuntu 24.04, Debian 12 supported (reject others with clear error)
5. Create server record with status `provisioning`
6. Generate one-time enrollment token (crypto/rand, 32 bytes)
7. Push agent installer script via SSH:
   - Download signed agent binary from platform (architecture-matched: amd64/arm64)
   - Verify SHA-256 checksum
   - Install to `/usr/local/bin/nixway-agent`
   - Create systemd service file
   - Configure agent with control plane URL + enrollment token
   - Start service
8. Agent starts, registers with control plane using enrollment token
9. Control plane marks server as `online` once first heartbeat received

### SSH Client
- Use `golang.org/x/crypto/ssh` for SSH operations
- Support ed25519 and RSA key types
- Connection timeout: 10 seconds
- Command timeout: 30 seconds

### Installer Script
- Bash script, generated per-server with embedded enrollment token and control plane URL
- Detects architecture (`uname -m`)
- Downloads agent binary from control plane's `/agent/download/:arch` endpoint
- Verifies checksum from `/agent/checksum/:arch` endpoint
- Creates systemd unit file with restart=always

---

## 3. Heartbeat + Status

### Extended Heartbeat
The Phase 0 heartbeat already sends basic data. Extend the `HealthReport` (or add new `ResourceReport`) message to include:
- CPU model + core count
- Total + available RAM
- Disk per mount point (mount, total, used)
- Network interfaces + IPs
- Kernel version
- Docker version (if installed)

### Status Transitions
- **online**: heartbeat received within last 20s (2 intervals)
- **degraded**: no heartbeat for 20-50s (2-5 missed)
- **offline**: no heartbeat for 50s+ (5+ missed)

### Status Watcher
- Background goroutine in control plane
- Runs every 10s
- Queries all servers, compares `last_seen_at` with current time
- Updates status field on transition
- Emits audit log on status change

---

## 4. Resource Inventory

### Collection
- Agent collects resource data on each heartbeat (every 10s)
- Data sent as part of extended heartbeat message
- Control plane upserts into `server_resources` table

### Data Sources (agent-side)
- CPU: `/proc/cpuinfo` or `runtime.NumCPU()` + `lscpu`
- RAM: `/proc/meminfo`
- Disk: `syscall.Statfs` per mount from `/proc/mounts`
- Network: `net.Interfaces()`
- Kernel: `uname -r`
- Docker: `docker version --format '{{.Server.Version}}'`

---

## 5. Server Tagging

### Design
- Key-value tags on servers (arbitrary, user-defined)
- Keys are lowercase alphanumeric + hyphens, max 63 chars
- Values are free text, max 255 chars
- Used in Phase 6 for placement constraints

### API Endpoints
```
GET    /api/v1/teams/:id/servers/:serverId/tags         — list tags
POST   /api/v1/teams/:id/servers/:serverId/tags         — set tag {key, value}
DELETE /api/v1/teams/:id/servers/:serverId/tags/:key    — delete tag
```

### Server List Filtering
- `GET /api/v1/teams/:id/servers?tag=env:prod` — filter by tag
- Multiple tags: `?tag=env:prod&tag=role:web` (AND logic)

---

## 6. Provisioning Engine

### Architecture
- Provisioning scripts embedded in the control plane binary via Go `embed`
- Each component is a self-contained bash script in `internal/provisioner/scripts/`
- Control plane pushes scripts to agent via gRPC (using existing FileTransfer mechanism)
- Agent executes scripts and streams stdout/stderr back as ProvisionOutput messages
- Control plane appends output to `provisioning_jobs.logs` in real-time

### Components (v1)

**Docker** (`docker.sh`)
- Install Docker CE from official repo
- Configure daemon: log rotation (max-size 10m, max-file 3), overlay2 storage driver, live-restore enabled
- Start and enable docker.service

**Traefik** (`traefik.sh`)
- Pull Traefik v3.x Docker image
- Create Traefik config directory at `/etc/traefik/`
- Generate static config: entrypoints (80, 443), Docker provider, file provider, Let's Encrypt cert resolver
- Create docker-compose file for Traefik container
- Start Traefik

**Nixpacks** (`nixpacks.sh`)
- Download latest nixpacks binary
- Install to `/usr/local/bin/nixpacks`
- Verify with `nixpacks --version`

**Cloud Native Buildpacks** (`buildpacks.sh`)
- Download `pack` CLI
- Install to `/usr/local/bin/pack`
- Set default builder
- Verify with `pack --version`

**Railpack** (`railpack.sh`)
- Download railpack CLI
- Install to `/usr/local/bin/railpack`
- Verify with `railpack --version`

### Provisioning Flow
1. User selects server + components
2. Control plane creates `provisioning_jobs` record with status `pending`
3. Control plane pushes scripts to agent
4. Agent executes scripts in order, streams logs
5. On success: job status → `completed`, server status stays `online`
6. On failure: job status → `failed`, error message stored, server remains functional
7. Retry: re-runs the failed component scripts

### API Endpoints
```
POST /api/v1/teams/:id/servers/:serverId/provision       — start provisioning {components: [...]}
GET  /api/v1/teams/:id/servers/:serverId/provision       — get latest provisioning status + logs
POST /api/v1/teams/:id/servers/:serverId/provision/retry  — retry failed provisioning
```

---

## 7. Auto-Discovery Engine

### Purpose
Inspect a repository directory tree and return ranked builder candidates with reasons.

### Detection Rules (priority order)
1. `Dockerfile` present → Docker (highest priority)
2. `nixpacks.toml` present → Nixpacks
3. `Procfile` + language lockfile → Buildpacks/Heroku
4. Language detection fallback:
   - `package.json` → Node via Nixpacks
   - `requirements.txt` or `pyproject.toml` → Python via Nixpacks
   - `go.mod` → Go via Nixpacks
   - `Cargo.toml` → Rust via Nixpacks
   - `Gemfile` → Ruby via Buildpacks

### Interface
```go
type BuilderCandidate struct {
    Builder    string  // "docker", "nixpacks", "buildpacks", "railpack"
    Confidence float64 // 0.0 - 1.0
    Reason     string  // "Dockerfile found at root"
}

func Discover(repoPath string) ([]BuilderCandidate, error)
```

### API Endpoint
```
POST /api/v1/auto-discover — {path: "/tmp/repo-clone"} → [{builder, confidence, reason}]
```

This is called during deploy setup in Phase 4 but the engine is built and tested now.

---

## 8. Agent Protocol Extensions

### New/Extended Messages

Add to `proto/agent/v1/agent.proto`:

```protobuf
message ResourceReport {
  string agent_id = 1;
  string cpu_model = 2;
  int32 cpu_cores = 3;
  uint64 memory_total = 4;
  uint64 memory_available = 5;
  string kernel_version = 6;
  string docker_version = 7;
  repeated DiskInfo disks = 8;
  repeated NetworkInterface network_interfaces = 9;
}

message NetworkInterface {
  string name = 1;
  repeated string ips = 2;
}

message ProvisionCommand {
  string job_id = 1;
  string component = 2;
  bytes script = 3;
}

message ProvisionOutput {
  string job_id = 1;
  string component = 2;
  bytes output = 3;
  bool finished = 4;
  bool success = 5;
  string error = 6;
}

message SSHKeyInstallCommand {
  string action = 1;  // "add" or "remove"
  string public_key = 2;
}

message SSHKeyInstallResult {
  bool success = 1;
  string error = 2;
}
```

Update `AgentMessage` and `ControlMessage` oneofs to include these new types.

---

## 9. Web UI Pages

### Server List Page
- Route: `/teams/:teamId/servers`
- TanStack Table with columns: Name, IP, Status (badge), OS, Tags, Last Seen
- Status filter (online/degraded/offline/all)
- Tag filter
- "Add Server" button → onboarding wizard dialog

### Server Detail Page
- Route: `/teams/:teamId/servers/:serverId`
- Tabs: Overview, Resources, Provisioning, Logs, Tags
- **Overview**: name, hostname, IP, SSH user/port, OS, status, uptime
- **Resources**: CPU cores, RAM usage bar, disk usage per mount, network interfaces
- **Provisioning**: component status checklist, logs viewer, retry button
- **Tags**: key-value list with add/remove

### SSH Keys Page
- Route: `/teams/:teamId/ssh-keys`
- List keys with fingerprint, type, created date
- Generate new key dialog
- Upload existing key dialog
- Delete confirmation

### Add Server Wizard
- Step 1: Server details (name, hostname, IP, SSH port, user)
- Step 2: Select SSH key
- Step 3: Connectivity check (live progress)
- Step 4: Select provisioning components
- Step 5: Provisioning progress (streaming logs)

---

## 10. File Structure (new files)

```
internal/
├── crypto/
│   └── secretbox.go          # libsodium secretbox encrypt/decrypt
├── ssh/
│   ├── client.go             # SSH client wrapper
│   ├── keygen.go             # ed25519/RSA key generation
│   └── fingerprint.go        # Key fingerprint computation
├── provisioner/
│   ├── provisioner.go        # Provisioning orchestrator
│   ├── scripts/
│   │   ├── docker.sh
│   │   ├── traefik.sh
│   │   ├── nixpacks.sh
│   │   ├── buildpacks.sh
│   │   └── railpack.sh
│   └── embed.go              # Go embed for scripts
├── discovery/
│   ├── discovery.go          # Auto-discovery engine
│   └── discovery_test.go     # Tests with sample repos
├── server/
│   ├── status.go             # Status watcher goroutine
│   └── onboarding.go         # Server onboarding orchestrator
├── api/handler/
│   ├── sshkey.go             # SSH key handlers
│   ├── server.go             # Server handlers
│   ├── provision.go          # Provisioning handlers
│   └── discovery.go          # Auto-discovery handler

sql/
├── migrations/
│   └── 00002_server_management.sql
├── queries/
│   ├── ssh_keys.sql
│   ├── servers.sql
│   ├── server_tags.sql
│   ├── server_resources.sql
│   └── provisioning_jobs.sql

apps/web/src/routes/_app/teams/$teamId/
├── servers/
│   ├── index.tsx             # Server list
│   └── $serverId.tsx         # Server detail
├── ssh-keys.tsx              # SSH key management

proto/agent/v1/
└── agent.proto               # Updated with new messages
```

---

## 11. Testing Strategy

### Unit Tests
- SSH key generation + encryption roundtrip
- Fingerprint computation
- Auto-discovery with 5 sample directory structures (Node, Python, Go, Rust, Dockerfile)
- Status transition logic

### Integration Tests
- Server add flow: create SSH key → add server (mock SSH) → agent registers → heartbeat → status online
- Provisioning: push script to agent → execute → logs stream → job completes
- Status transitions: stop heartbeat → degraded → offline
- Resource inventory: heartbeat with resource data → stored in DB
- SSH key rotation: add new key → verify → remove old
- Tag CRUD: create, list, filter, delete
- Server removal: deregister agent, clean up records

### Exit Criteria (from spec)
1. User adds server, agent installs and reports online within 2 minutes
2. User selects components, provisioning completes with logs visible in UI
3. Resource metrics update on heartbeat
4. Auto-discovery correctly identifies builder for 5 sample repos
5. Server reboot: agent reconnects, state restored
6. SSH key rotation: old key removed, new key works
7. Removing server: deregisters, offers optional cleanup
8. Tagging a server with `env=prod` is visible and filterable

---

## Tech Stack (Phase 1 additions)

| Component | Technology |
|-----------|-----------|
| SSH client | golang.org/x/crypto/ssh |
| Key encryption | libsodium secretbox (golang.org/x/crypto/nacl/secretbox) |
| Key derivation | HKDF (golang.org/x/crypto/hkdf) |
| Script embedding | Go embed |
| OS detection | /etc/os-release parsing |
| Resource collection | /proc filesystem + syscall.Statfs |
