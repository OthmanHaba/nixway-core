# Phase 2: Clusters + Private Networking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add cluster management with WireGuard mesh networking, private CIDR allocation, CoreDNS for cluster-internal DNS resolution, mesh health monitoring with auto-repair, and a cluster detail UI with an N x N mesh health matrix.

**Architecture:** Extends Phase 1 server management. New DB tables for clusters, cluster members, WireGuard peers, and mesh events. Agent protocol extended with WireGuard key generation, config application, teardown, mesh health reports, and DNS management commands. CoreDNS deployed as a Docker container on each cluster node. Full mesh topology — every node peers with every other node.

**Tech Stack:** WireGuard (kernel module + wg-quick), CoreDNS (Docker), Go `net` stdlib for CIDR math, Go `text/template` for WireGuard configs, ICMP ping + `wg show` for health checks

---

## Existing Codebase Reference

- **Router**: `internal/api/router.go` — `NewRouter(queries, sessions, emailSender, auditWriter, cfg, logger, redisClient, masterKey, onboardingSvc, provisionSvc) http.Handler`
- **DB**: `internal/db/` — sqlc generated, `db.New(pool) *Queries`
- **Agent server**: `internal/agent/server.go` — `Server` with `Connect()` + `Register()` RPCs, handles `AgentMessage` oneofs in a switch
- **ConnManager**: `internal/agent/connmanager.go` — `Register()`, `Heartbeat()`, `Disconnect()`, `GetState()`, `ListOnline()`, `SetStream()`, `SendToAgent()`, `UpdateResources()`
- **Proto**: `proto/agent/v1/agent.proto` — AgentMessage (heartbeat, exec_output, health_report, file_chunk, resource_report, provision_output, ssh_key_result), ControlMessage (exec_command, file_transfer, cert_rotation, provision_command, ssh_key_install)
- **Config**: `internal/config/config.go` — `Config` struct with Server, Database, Redis, Auth, Email, Crypto sub-configs
- **Provisioner**: `internal/provisioner/service.go` — `Service.RunProvisioning()` SSHes into server, pushes scripts, streams output via Redis pub/sub
- **Audit**: `internal/audit/audit.go` — `Writer.Log(ctx, Entry)`
- **Respond**: `internal/api/respond/respond.go` — `JSON()`, `Error()`, `DecodeJSON()`
- **Handlers pattern**: struct with dependencies (queries, audit, logger, etc.), methods per endpoint
- **pgtype conversions**: `pgtype.UUID{Bytes: id, Valid: true}`, `pgtype.Timestamptz{Time: t, Valid: true}`
- **SSH client**: `internal/ssh/client.go` — `NewClient()`, `RunCommand()`, `RunCommandStreaming()`, `PushFile()`
- **Crypto**: `internal/crypto/secretbox.go` — `Encrypt()`, `Decrypt()`, `MasterKeyFromHex()`
- **Provisioner embed**: `internal/provisioner/embed.go` — `GetScript(component)`, `Scripts embed.FS`
- **Server handler**: `internal/api/handler/server_handler.go` — follows pattern: parse auth ctx, parse path params, decode body, call service, audit log, respond JSON
- **Existing migrations**: `sql/migrations/00001_initial_schema.sql`, `00002_server_management.sql`
- **Web routes**: `apps/web/src/routes/_app/` — TanStack Router, files like `servers.$teamId.tsx`, `servers_.$teamId.$serverId.tsx`

---

## File Map

### New Files

```
internal/
├── cluster/
│   ├── service.go               # Cluster CRUD + member management orchestrator
│   ├── service_test.go          # Unit tests for cluster service
│   ├── cidr.go                  # CIDR allocation algorithm (pool + per-cluster)
│   ├── cidr_test.go             # CIDR allocation unit tests
│   └── slug.go                  # Slug generation + validation
├── mesh/
│   ├── manager.go               # Mesh regeneration orchestrator
│   ├── manager_test.go          # Mesh manager unit tests
│   ├── config.go                # WireGuard config template generation
│   ├── config_test.go           # Config generation unit tests
│   ├── health.go                # Health check processor + status transitions
│   ├── health_test.go           # Health status transition tests
│   └── repair.go                # Auto-repair logic
├── dns/
│   ├── manager.go               # DNS record management + CoreDNS deployment
│   ├── manager_test.go          # DNS manager unit tests
│   ├── hosts.go                 # Hosts file generation
│   ├── corefile.go              # Corefile template generation
│   └── scripts/
│       └── coredns.sh           # CoreDNS Docker container deployment script
├── api/handler/
│   ├── cluster.go               # Cluster CRUD handlers
│   ├── cluster_member.go        # Member add/remove/list handlers
│   └── mesh.go                  # Health matrix, key rotation, events handlers

sql/
├── migrations/
│   └── 00003_clusters_networking.sql
├── queries/
│   ├── clusters.sql
│   ├── cluster_members.sql
│   ├── wireguard_peers.sql
│   └── mesh_events.sql

apps/web/src/
├── routes/_app/
│   ├── clusters.$teamId.tsx              # Cluster list page
│   └── clusters_.$teamId.$clusterId.tsx  # Cluster detail page (tabs)
├── components/
│   └── mesh-health-matrix.tsx            # N x N health grid component

proto/agent/v1/
└── agent.proto                           # Extended (WireGuard + DNS messages)
```

### Modified Files

```
internal/config/config.go                 # Add WireGuard pool CIDR + default port
internal/api/router.go                    # Register cluster/mesh/dns routes
internal/agent/server.go                  # Handle WireGuard + DNS + MeshHealth message types
internal/agent/connmanager.go             # Track mesh health data per agent
apps/api/main.go                          # Wire cluster, mesh, DNS services
apps/agent/main.go                        # WireGuard mgmt, mesh health goroutine, DNS handler
apps/agent/client.go                      # Handle new ControlMessage types
```

---

## Task 1: Database Migration — Clusters + Networking Tables

**Files:**
- Create: `sql/migrations/00003_clusters_networking.sql`

- [ ] **Step 1: Write migration**

```sql
-- +goose Up

CREATE TABLE clusters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    cidr CIDR NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'degraded', 'error')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (team_id, slug),
    UNIQUE (cidr)
);

CREATE TABLE cluster_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    wireguard_ip INET NOT NULL,
    wireguard_public_key TEXT NOT NULL,
    wireguard_endpoint TEXT NOT NULL,
    listen_port INT NOT NULL DEFAULT 51820,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (server_id),
    UNIQUE (cluster_id, wireguard_ip)
);

CREATE TABLE wireguard_peers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    member_id UUID NOT NULL REFERENCES cluster_members(id) ON DELETE CASCADE,
    peer_member_id UUID NOT NULL REFERENCES cluster_members(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'active', 'degraded', 'failed')),
    last_handshake_at TIMESTAMPTZ,
    last_check_at TIMESTAMPTZ,
    rtt_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (member_id, peer_member_id)
);

CREATE TABLE mesh_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cluster_id UUID NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    member_id UUID REFERENCES cluster_members(id) ON DELETE SET NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add cluster_id to servers for convenience lookups
ALTER TABLE servers ADD COLUMN cluster_id UUID REFERENCES clusters(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX idx_clusters_team ON clusters(team_id);
CREATE INDEX idx_cluster_members_cluster ON cluster_members(cluster_id);
CREATE INDEX idx_cluster_members_server ON cluster_members(server_id);
CREATE INDEX idx_wireguard_peers_member ON wireguard_peers(member_id);
CREATE INDEX idx_wireguard_peers_peer ON wireguard_peers(peer_member_id);
CREATE INDEX idx_wireguard_peers_status ON wireguard_peers(status);
CREATE INDEX idx_mesh_events_cluster ON mesh_events(cluster_id);
CREATE INDEX idx_mesh_events_created ON mesh_events(cluster_id, created_at DESC);
CREATE INDEX idx_servers_cluster ON servers(cluster_id) WHERE cluster_id IS NOT NULL;

-- +goose Down
ALTER TABLE servers DROP COLUMN IF EXISTS cluster_id;
DROP TABLE IF EXISTS mesh_events;
DROP TABLE IF EXISTS wireguard_peers;
DROP TABLE IF EXISTS cluster_members;
DROP TABLE IF EXISTS clusters;
```

- [ ] **Step 2: Verify migration syntax**

Run: `goose -dir sql/migrations postgres "$DATABASE_URL" up`
Expected: `OK 00003_clusters_networking.sql`

- [ ] **Step 3: Commit**

```bash
git add sql/migrations/00003_clusters_networking.sql
git commit -m "feat: add clusters and networking database tables"
```

---

## Task 2: sqlc Queries for Clusters + Networking

**Files:**
- Create: `sql/queries/clusters.sql`, `sql/queries/cluster_members.sql`, `sql/queries/wireguard_peers.sql`, `sql/queries/mesh_events.sql`

- [ ] **Step 1: Write cluster queries**

`sql/queries/clusters.sql`:
```sql
-- name: CreateCluster :one
INSERT INTO clusters (team_id, name, slug, description, region, cidr)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetClusterByID :one
SELECT * FROM clusters WHERE id = $1 AND team_id = $2;

-- name: GetClusterBySlug :one
SELECT * FROM clusters WHERE slug = $1 AND team_id = $2;

-- name: ListClustersByTeam :many
SELECT * FROM clusters WHERE team_id = $1 ORDER BY created_at DESC;

-- name: UpdateCluster :one
UPDATE clusters SET name = $3, description = $4, region = $5, updated_at = now()
WHERE id = $1 AND team_id = $2 RETURNING *;

-- name: UpdateClusterStatus :exec
UPDATE clusters SET status = $2, updated_at = now() WHERE id = $1;

-- name: DeleteCluster :exec
DELETE FROM clusters WHERE id = $1 AND team_id = $2;

-- name: ListAllClusterCIDRs :many
SELECT cidr FROM clusters;

-- name: CountClusterMembers :one
SELECT count(*) FROM cluster_members WHERE cluster_id = $1;
```

- [ ] **Step 2: Write cluster member queries**

`sql/queries/cluster_members.sql`:
```sql
-- name: CreateClusterMember :one
INSERT INTO cluster_members (cluster_id, server_id, wireguard_ip, wireguard_public_key, wireguard_endpoint, listen_port)
VALUES ($1, $2, $3, $4, $5, $6) RETURNING *;

-- name: GetClusterMemberByID :one
SELECT * FROM cluster_members WHERE id = $1;

-- name: GetClusterMemberByServerID :one
SELECT * FROM cluster_members WHERE server_id = $1;

-- name: ListClusterMembers :many
SELECT cm.*, s.name AS server_name, s.public_ip, s.status AS server_status
FROM cluster_members cm
JOIN servers s ON cm.server_id = s.id
WHERE cm.cluster_id = $1
ORDER BY cm.joined_at;

-- name: ListClusterMemberIPs :many
SELECT wireguard_ip FROM cluster_members WHERE cluster_id = $1;

-- name: DeleteClusterMember :exec
DELETE FROM cluster_members WHERE cluster_id = $1 AND server_id = $2;

-- name: DeleteClusterMemberByID :exec
DELETE FROM cluster_members WHERE id = $1;

-- name: UpdateClusterMemberPublicKey :exec
UPDATE cluster_members SET wireguard_public_key = $2 WHERE id = $1;

-- name: GetClusterMembersForMesh :many
SELECT cm.id, cm.cluster_id, cm.server_id, cm.wireguard_ip, cm.wireguard_public_key,
       cm.wireguard_endpoint, cm.listen_port, s.name AS server_name, s.agent_id
FROM cluster_members cm
JOIN servers s ON cm.server_id = s.id
WHERE cm.cluster_id = $1;
```

- [ ] **Step 3: Write WireGuard peer queries**

`sql/queries/wireguard_peers.sql`:
```sql
-- name: CreateWireGuardPeer :one
INSERT INTO wireguard_peers (member_id, peer_member_id, status)
VALUES ($1, $2, 'pending') RETURNING *;

-- name: UpsertWireGuardPeer :exec
INSERT INTO wireguard_peers (member_id, peer_member_id, status)
VALUES ($1, $2, $3)
ON CONFLICT (member_id, peer_member_id) DO UPDATE SET
    status = EXCLUDED.status,
    last_check_at = now();

-- name: UpdatePeerHealth :exec
UPDATE wireguard_peers SET
    status = $3,
    last_handshake_at = $4,
    last_check_at = now(),
    rtt_ms = $5
WHERE member_id = $1 AND peer_member_id = $2;

-- name: ListPeersByMember :many
SELECT wp.*, cm.wireguard_ip AS peer_ip, s.name AS peer_server_name
FROM wireguard_peers wp
JOIN cluster_members cm ON wp.peer_member_id = cm.id
JOIN servers s ON cm.server_id = s.id
WHERE wp.member_id = $1;

-- name: ListPeersByCluster :many
SELECT wp.*, 
       cm_from.wireguard_ip AS from_ip, s_from.name AS from_server_name,
       cm_to.wireguard_ip AS to_ip, s_to.name AS to_server_name
FROM wireguard_peers wp
JOIN cluster_members cm_from ON wp.member_id = cm_from.id
JOIN cluster_members cm_to ON wp.peer_member_id = cm_to.id
JOIN servers s_from ON cm_from.server_id = s_from.id
JOIN servers s_to ON cm_to.server_id = s_to.id
WHERE cm_from.cluster_id = $1;

-- name: DeletePeersByMember :exec
DELETE FROM wireguard_peers WHERE member_id = $1 OR peer_member_id = $1;

-- name: GetPeerStatus :one
SELECT status FROM wireguard_peers WHERE member_id = $1 AND peer_member_id = $2;

-- name: CountFailedPeersByCluster :one
SELECT count(*) FROM wireguard_peers wp
JOIN cluster_members cm ON wp.member_id = cm.id
WHERE cm.cluster_id = $1 AND wp.status = 'failed';

-- name: CountTotalPeersByCluster :one
SELECT count(*) FROM wireguard_peers wp
JOIN cluster_members cm ON wp.member_id = cm.id
WHERE cm.cluster_id = $1;
```

- [ ] **Step 4: Write mesh event queries**

`sql/queries/mesh_events.sql`:
```sql
-- name: CreateMeshEvent :one
INSERT INTO mesh_events (cluster_id, event_type, member_id, details)
VALUES ($1, $2, $3, $4) RETURNING *;

-- name: ListMeshEvents :many
SELECT * FROM mesh_events
WHERE cluster_id = $1
ORDER BY created_at DESC
LIMIT $2 OFFSET $3;

-- name: ListMeshEventsByType :many
SELECT * FROM mesh_events
WHERE cluster_id = $1 AND event_type = $2
ORDER BY created_at DESC
LIMIT $3 OFFSET $4;
```

- [ ] **Step 5: Regenerate sqlc**

```bash
sqlc generate
cd internal && go build ./db/
```

- [ ] **Step 6: Commit**

```bash
git add sql/queries/clusters.sql sql/queries/cluster_members.sql sql/queries/wireguard_peers.sql sql/queries/mesh_events.sql internal/db/
git commit -m "feat: add sqlc queries for clusters, members, peers, and mesh events"
```

---

## Task 3: CIDR Allocation Algorithm

**Files:**
- Create: `internal/cluster/cidr.go`, `internal/cluster/cidr_test.go`

- [ ] **Step 1: Write CIDR allocation tests**

```go
package cluster_test

import (
	"net"
	"testing"

	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAllocateClusterCIDR(t *testing.T) {
	alloc := cluster.NewCIDRAllocator("10.100.0.0/10")

	// First allocation should be 10.100.0.0/16
	cidr1, err := alloc.AllocateClusterCIDR(nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.0/16", cidr1.String())

	// Second should be 10.101.0.0/16
	cidr2, err := alloc.AllocateClusterCIDR([]string{"10.100.0.0/16"})
	require.NoError(t, err)
	assert.Equal(t, "10.101.0.0/16", cidr2.String())
}

func TestAllocateClusterCIDR_SkipsUsed(t *testing.T) {
	alloc := cluster.NewCIDRAllocator("10.100.0.0/10")

	// With 10.100 and 10.101 used, next should be 10.102
	cidr, err := alloc.AllocateClusterCIDR([]string{"10.100.0.0/16", "10.101.0.0/16"})
	require.NoError(t, err)
	assert.Equal(t, "10.102.0.0/16", cidr.String())
}

func TestAllocateServerIP(t *testing.T) {
	alloc := cluster.NewCIDRAllocator("10.100.0.0/10")

	// First server in cluster
	ip1, err := alloc.AllocateServerIP("10.100.0.0/16", nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.1", ip1.String())

	// Second server
	ip2, err := alloc.AllocateServerIP("10.100.0.0/16", []string{"10.100.0.1"})
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.2", ip2.String())
}

func TestAllocateServerIP_SkipsUsed(t *testing.T) {
	alloc := cluster.NewCIDRAllocator("10.100.0.0/10")

	ip, err := alloc.AllocateServerIP("10.100.0.0/16", []string{"10.100.0.1", "10.100.0.2"})
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.3", ip.String())
}

func TestAllocateServerIP_SkipsNetworkAndBroadcast(t *testing.T) {
	alloc := cluster.NewCIDRAllocator("10.100.0.0/10")

	// .0 is network address, should start at .1
	ip, err := alloc.AllocateServerIP("10.100.0.0/16", nil)
	require.NoError(t, err)
	assert.Equal(t, "10.100.0.1", ip.String())
}
```

- [ ] **Step 2: Write CIDR allocation implementation**

```go
package cluster

import (
	"fmt"
	"net"
)

// CIDRAllocator manages IP allocation for clusters and servers.
type CIDRAllocator struct {
	pool *net.IPNet
}

// NewCIDRAllocator creates a new allocator from a pool CIDR string.
func NewCIDRAllocator(poolCIDR string) *CIDRAllocator {
	_, pool, err := net.ParseCIDR(poolCIDR)
	if err != nil {
		panic(fmt.Sprintf("invalid pool CIDR: %s", poolCIDR))
	}
	return &CIDRAllocator{pool: pool}
}

// AllocateClusterCIDR returns the next available /16 from the pool.
// usedCIDRs is the list of already-allocated cluster CIDRs from the DB.
func (a *CIDRAllocator) AllocateClusterCIDR(usedCIDRs []string) (net.IPNet, error) {
	used := make(map[string]bool)
	for _, c := range usedCIDRs {
		used[c] = true
	}

	// Iterate through /16 blocks within the pool
	ip := make(net.IP, 4)
	copy(ip, a.pool.IP.To4())

	for a.pool.Contains(ip) {
		candidate := net.IPNet{
			IP:   make(net.IP, 4),
			Mask: net.CIDRMask(16, 32),
		}
		copy(candidate.IP, ip)

		if !used[candidate.String()] {
			return candidate, nil
		}

		// Move to next /16 block
		ip[1]++
		if ip[1] == 0 {
			// Overflowed the second octet
			break
		}
	}

	return net.IPNet{}, fmt.Errorf("no available /16 CIDRs in pool %s", a.pool.String())
}

// AllocateServerIP returns the next available IP within a cluster's CIDR.
// usedIPs is the list of already-assigned WireGuard IPs from the DB.
func (a *CIDRAllocator) AllocateServerIP(clusterCIDR string, usedIPs []string) (net.IP, error) {
	_, cidr, err := net.ParseCIDR(clusterCIDR)
	if err != nil {
		return nil, fmt.Errorf("invalid cluster CIDR: %w", err)
	}

	used := make(map[string]bool)
	for _, ip := range usedIPs {
		used[ip] = true
	}

	ip := make(net.IP, 4)
	copy(ip, cidr.IP.To4())

	// Start at .1 (skip .0 network address)
	ip[3] = 1

	for cidr.Contains(ip) {
		if !used[ip.String()] {
			result := make(net.IP, 4)
			copy(result, ip)
			return result, nil
		}

		// Increment IP
		incrementIP(ip)
	}

	return nil, fmt.Errorf("no available IPs in CIDR %s", clusterCIDR)
}

func incrementIP(ip net.IP) {
	for i := len(ip) - 1; i >= 0; i-- {
		ip[i]++
		if ip[i] != 0 {
			break
		}
	}
}
```

- [ ] **Step 3: Run tests**

```bash
cd internal && go test ./cluster/ -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/cluster/
git commit -m "feat: add CIDR allocation algorithm for clusters and server IPs"
```

---

## Task 4: Slug Generation

**Files:**
- Create: `internal/cluster/slug.go`

- [ ] **Step 1: Write slug generator**

```go
package cluster

import (
	"regexp"
	"strings"
)

var nonAlphaNum = regexp.MustCompile(`[^a-z0-9-]`)
var multiDash = regexp.MustCompile(`-+`)

// GenerateSlug converts a cluster name into a URL-safe slug.
func GenerateSlug(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	slug = nonAlphaNum.ReplaceAllString(slug, "-")
	slug = multiDash.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		slug = "cluster"
	}
	if len(slug) > 63 {
		slug = slug[:63]
	}
	return slug
}

// ValidateSlug checks if a slug is valid for DNS usage.
func ValidateSlug(slug string) bool {
	if slug == "" || len(slug) > 63 {
		return false
	}
	matched, _ := regexp.MatchString(`^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, slug)
	return matched
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./cluster/
```

- [ ] **Step 3: Commit**

```bash
git add internal/cluster/slug.go
git commit -m "feat: add cluster slug generation and validation"
```

---

## Task 5: WireGuard Config Generation

**Files:**
- Create: `internal/mesh/config.go`, `internal/mesh/config_test.go`

- [ ] **Step 1: Write config generation tests**

```go
package mesh_test

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenerateConfig_SingleNode(t *testing.T) {
	members := []mesh.MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "key1", Endpoint: "1.2.3.4:51820", ListenPort: 51820},
	}
	cfg, err := mesh.GenerateConfig(members[0], members)
	require.NoError(t, err)
	assert.Contains(t, cfg, "Address = 10.100.0.1/32")
	assert.Contains(t, cfg, "ListenPort = 51820")
	assert.NotContains(t, cfg, "[Peer]") // no peers for single node
}

func TestGenerateConfig_ThreeNodes(t *testing.T) {
	members := []mesh.MemberInfo{
		{WireGuardIP: "10.100.0.1", PublicKey: "key1", Endpoint: "1.2.3.4:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.2", PublicKey: "key2", Endpoint: "5.6.7.8:51820", ListenPort: 51820},
		{WireGuardIP: "10.100.0.3", PublicKey: "key3", Endpoint: "9.10.11.12:51820", ListenPort: 51820},
	}

	// Config for node 1 should have peers for nodes 2 and 3
	cfg, err := mesh.GenerateConfig(members[0], members)
	require.NoError(t, err)
	assert.Contains(t, cfg, "Address = 10.100.0.1/32")
	assert.Contains(t, cfg, "PublicKey = key2")
	assert.Contains(t, cfg, "PublicKey = key3")
	assert.Contains(t, cfg, "AllowedIPs = 10.100.0.2/32")
	assert.Contains(t, cfg, "AllowedIPs = 10.100.0.3/32")
	assert.Contains(t, cfg, "PersistentKeepalive = 25")
	assert.NotContains(t, cfg, "PublicKey = key1") // should not peer with self
}
```

- [ ] **Step 2: Write config generation implementation**

```go
package mesh

import (
	"bytes"
	"fmt"
	"text/template"
)

// MemberInfo holds the data needed to generate a WireGuard config.
type MemberInfo struct {
	MemberID    string
	ServerName  string
	AgentID     string
	WireGuardIP string
	PublicKey   string
	Endpoint    string
	ListenPort  int
}

const wgConfigTemplate = `[Interface]
Address = {{.Self.WireGuardIP}}/32
ListenPort = {{.Self.ListenPort}}
PrivateKey = PRIVATE_KEY_PLACEHOLDER
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT
{{range .Peers}}
[Peer]
PublicKey = {{.PublicKey}}
AllowedIPs = {{.WireGuardIP}}/32
Endpoint = {{.Endpoint}}
PersistentKeepalive = 25
{{end}}`

type configData struct {
	Self  MemberInfo
	Peers []MemberInfo
}

// GenerateConfig produces a WireGuard config for the given member.
// The PrivateKey line uses a placeholder — the agent replaces it with the actual key path.
func GenerateConfig(self MemberInfo, allMembers []MemberInfo) (string, error) {
	var peers []MemberInfo
	for _, m := range allMembers {
		if m.WireGuardIP == self.WireGuardIP {
			continue // skip self
		}
		peers = append(peers, m)
	}

	tmpl, err := template.New("wg").Parse(wgConfigTemplate)
	if err != nil {
		return "", fmt.Errorf("parse template: %w", err)
	}

	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, configData{Self: self, Peers: peers}); err != nil {
		return "", fmt.Errorf("execute template: %w", err)
	}

	return buf.String(), nil
}
```

- [ ] **Step 3: Run tests**

```bash
cd internal && go test ./mesh/ -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/mesh/
git commit -m "feat: add WireGuard config template generation"
```

---

## Task 6: DNS — Hosts File + Corefile Generation

**Files:**
- Create: `internal/dns/hosts.go`, `internal/dns/corefile.go`, `internal/dns/manager.go`, `internal/dns/scripts/coredns.sh`

- [ ] **Step 1: Write hosts file generator**

```go
package dns

import (
	"fmt"
	"strings"
)

// Record represents a DNS A record.
type Record struct {
	Hostname string
	IP       string
}

// GenerateHostsFile produces a CoreDNS-compatible hosts file.
func GenerateHostsFile(records []Record) string {
	var lines []string
	for _, r := range records {
		lines = append(lines, fmt.Sprintf("%s\t%s", r.IP, r.Hostname))
	}
	return strings.Join(lines, "\n") + "\n"
}

// BuildRecords creates DNS records for all cluster members.
func BuildRecords(clusterSlug string, members []MemberDNSInfo) []Record {
	var records []Record
	for _, m := range members {
		hostname := fmt.Sprintf("%s.%s.internal", m.ServerName, clusterSlug)
		records = append(records, Record{Hostname: hostname, IP: m.WireGuardIP})
	}
	return records
}

// MemberDNSInfo holds minimal info needed for DNS record generation.
type MemberDNSInfo struct {
	ServerName  string
	WireGuardIP string
}
```

- [ ] **Step 2: Write Corefile generator**

```go
package dns

import "fmt"

// GenerateCorefile produces a CoreDNS Corefile for a cluster zone.
func GenerateCorefile(clusterSlug string) string {
	return fmt.Sprintf(`%s.internal {
    hosts /etc/coredns/hosts {
        fallthrough
    }
    log
    errors
}

. {
    forward . 8.8.8.8 1.1.1.1
    log
    errors
    cache 30
}
`, clusterSlug)
}
```

- [ ] **Step 3: Write CoreDNS deployment script**

`internal/dns/scripts/coredns.sh`:
```bash
#!/bin/bash
set -euo pipefail
echo "=== Deploying CoreDNS ==="

COREDNS_DIR="/etc/coredns"
mkdir -p "$COREDNS_DIR"

# Corefile and hosts file are written by the agent before this script runs

docker pull coredns/coredns:1.11

docker rm -f nixway-coredns 2>/dev/null || true

# Get the WireGuard IP for binding
WG_IP=$(ip -4 addr show wg0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}')

docker run -d --name nixway-coredns --restart=always \
  --network host \
  -v /etc/coredns:/etc/coredns:ro \
  coredns/coredns:1.11 \
  -conf /etc/coredns/Corefile

# Update resolv.conf to use local CoreDNS
if ! grep -q "$WG_IP" /etc/resolv.conf; then
  sed -i "1i nameserver $WG_IP" /etc/resolv.conf
fi

echo "=== CoreDNS deployed, listening on $WG_IP:53 ==="
```

- [ ] **Step 4: Write DNS manager**

`internal/dns/manager.go` — orchestrator that takes cluster members, generates hosts file + Corefile, and sends `DNSUpdateHostsCommand` to agents via ConnManager.

```go
package dns

import (
	"embed"
	"log/slog"
)

//go:embed scripts/*.sh
var scripts embed.FS

// GetCoresDNSScript returns the CoreDNS deployment script.
func GetCoreDNSScript() ([]byte, error) {
	return scripts.ReadFile("scripts/coredns.sh")
}

// Manager coordinates DNS updates across cluster members.
type Manager struct {
	logger *slog.Logger
}

func NewManager(logger *slog.Logger) *Manager {
	return &Manager{logger: logger}
}
```

- [ ] **Step 5: Run tests**

```bash
cd internal && go test ./dns/ -v
```

- [ ] **Step 6: Commit**

```bash
git add internal/dns/
git commit -m "feat: add DNS hosts/corefile generation and CoreDNS deployment script"
```

---

## Task 7: Mesh Health Processor

**Files:**
- Create: `internal/mesh/health.go`, `internal/mesh/health_test.go`

- [ ] **Step 1: Write health processor tests**

```go
package mesh_test

import (
	"testing"

	"github.com/othmanhaba/nixway-core/internal/mesh"
	"github.com/stretchr/testify/assert"
)

func TestDeriveClusterStatus_AllActive(t *testing.T) {
	statuses := []string{"active", "active", "active"}
	assert.Equal(t, "active", mesh.DeriveClusterStatus(statuses))
}

func TestDeriveClusterStatus_SomeDegraded(t *testing.T) {
	statuses := []string{"active", "degraded", "active"}
	assert.Equal(t, "degraded", mesh.DeriveClusterStatus(statuses))
}

func TestDeriveClusterStatus_MajorityFailed(t *testing.T) {
	statuses := []string{"failed", "failed", "active"}
	assert.Equal(t, "error", mesh.DeriveClusterStatus(statuses))
}

func TestDeriveClusterStatus_Empty(t *testing.T) {
	assert.Equal(t, "active", mesh.DeriveClusterStatus(nil))
}

func TestDerivePeerStatus(t *testing.T) {
	assert.Equal(t, "active", mesh.DerivePeerStatus(true, 100, 200))
	assert.Equal(t, "degraded", mesh.DerivePeerStatus(true, 100, 400))
	assert.Equal(t, "degraded", mesh.DerivePeerStatus(true, 600, 100))
	assert.Equal(t, "failed", mesh.DerivePeerStatus(false, 0, 0))
}
```

- [ ] **Step 2: Write health processor implementation**

```go
package mesh

// DerivePeerStatus determines a peer link's status from health check data.
// rttMs: round-trip time in milliseconds.
// handshakeAgeSec: seconds since last WireGuard handshake.
func DerivePeerStatus(reachable bool, rttMs int, handshakeAgeSec int) string {
	if !reachable {
		return "failed"
	}
	if handshakeAgeSec > 300 || rttMs > 500 {
		return "degraded"
	}
	return "active"
}

// DeriveClusterStatus determines overall cluster status from peer link statuses.
func DeriveClusterStatus(peerStatuses []string) string {
	if len(peerStatuses) == 0 {
		return "active"
	}

	failed := 0
	degraded := 0
	for _, s := range peerStatuses {
		switch s {
		case "failed":
			failed++
		case "degraded":
			degraded++
		}
	}

	total := len(peerStatuses)
	if failed > total/2 {
		return "error"
	}
	if failed > 0 || degraded > 0 {
		return "degraded"
	}
	return "active"
}
```

- [ ] **Step 3: Run tests**

```bash
cd internal && go test ./mesh/ -v
```

- [ ] **Step 4: Commit**

```bash
git add internal/mesh/health.go internal/mesh/health_test.go
git commit -m "feat: add mesh health status derivation logic"
```

---

## Task 8: Mesh Manager — Regeneration Orchestrator

**Files:**
- Create: `internal/mesh/manager.go`, `internal/mesh/repair.go`

- [ ] **Step 1: Write mesh manager**

The mesh manager orchestrates full mesh regeneration when topology changes. It:
1. Fetches all cluster members from DB
2. Generates a WireGuard config for each member using `mesh.GenerateConfig()`
3. Creates/updates `wireguard_peers` rows for every pair
4. Sends `WireGuardApplyConfigCommand` to each agent via `ConnManager.SendToAgent()`
5. Sends `DNSUpdateHostsCommand` to each agent with updated hosts
6. Logs a `mesh_regenerated` mesh event

```go
package mesh

import (
	"context"
	"log/slog"

	"github.com/othmanhaba/nixway-core/internal/agent"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/dns"
)

// Manager orchestrates WireGuard mesh configuration and health.
type Manager struct {
	queries  *db.Queries
	conn     *agent.ConnManager
	dns      *dns.Manager
	logger   *slog.Logger
}

func NewManager(queries *db.Queries, conn *agent.ConnManager, dnsManager *dns.Manager, logger *slog.Logger) *Manager {
	return &Manager{queries: queries, conn: conn, dns: dnsManager, logger: logger}
}

// RegenerateMesh rebuilds the full WireGuard mesh for a cluster.
// Called on: member add, member remove, key rotation.
func (m *Manager) RegenerateMesh(ctx context.Context, clusterID uuid.UUID) error {
	// 1. Fetch all members with server details
	members, err := m.queries.GetClusterMembersForMesh(ctx, clusterID)
	if err != nil {
		return fmt.Errorf("fetch members: %w", err)
	}

	if len(members) == 0 {
		return nil
	}

	// 2. Build MemberInfo list
	infos := make([]MemberInfo, len(members))
	for i, m := range members {
		infos[i] = MemberInfo{
			MemberID:    m.ID.String(),
			ServerName:  m.ServerName,
			AgentID:     derefStr(m.AgentID),
			WireGuardIP: m.WireguardIp.String(),
			PublicKey:   m.WireguardPublicKey,
			Endpoint:    m.WireguardEndpoint,
			ListenPort:  int(m.ListenPort),
		}
	}

	// 3. Generate and push configs to each agent
	for _, self := range infos {
		config, err := GenerateConfig(self, infos)
		if err != nil {
			m.logger.Error("failed to generate config", "member", self.MemberID, "error", err)
			continue
		}

		if self.AgentID == "" {
			m.logger.Warn("member has no agent_id, skipping config push", "member", self.MemberID)
			continue
		}

		// Send WireGuardApplyConfigCommand via gRPC
		// (implementation sends ControlMessage with the config)
		if err := m.pushConfig(ctx, self.AgentID, config); err != nil {
			m.logger.Error("failed to push config", "agent_id", self.AgentID, "error", err)
		}
	}

	// 4. Create/update peer rows
	m.syncPeerRows(ctx, clusterID, members)

	// 5. Update DNS
	m.updateDNS(ctx, clusterID, infos)

	// 6. Log event
	m.logEvent(ctx, clusterID, "mesh_regenerated", nil)

	return nil
}
```

- [ ] **Step 2: Write auto-repair logic**

`internal/mesh/repair.go` — handles re-pushing configs on link failure, attempts up to 2 retries before marking as persistent.

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./mesh/
```

- [ ] **Step 4: Commit**

```bash
git add internal/mesh/manager.go internal/mesh/repair.go
git commit -m "feat: add mesh regeneration orchestrator and auto-repair logic"
```

---

## Task 9: Cluster Service

**Files:**
- Create: `internal/cluster/service.go`, `internal/cluster/service_test.go`

- [ ] **Step 1: Write cluster service**

The cluster service handles CRUD and member management. It coordinates with the CIDR allocator and mesh manager.

```go
package cluster

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/db"
	"github.com/othmanhaba/nixway-core/internal/mesh"
)

type Service struct {
	queries     *db.Queries
	allocator   *CIDRAllocator
	meshManager *mesh.Manager
	logger      *slog.Logger
}

func NewService(queries *db.Queries, allocator *CIDRAllocator, meshManager *mesh.Manager, logger *slog.Logger) *Service {
	return &Service{
		queries:     queries,
		allocator:   allocator,
		meshManager: meshManager,
		logger:      logger,
	}
}

type CreateClusterRequest struct {
	TeamID      uuid.UUID
	Name        string
	Description string
	Region      string
}

type AddMemberRequest struct {
	TeamID    uuid.UUID
	ClusterID uuid.UUID
	ServerID  uuid.UUID
}

// CreateCluster creates a new cluster with an auto-allocated CIDR.
func (s *Service) CreateCluster(ctx context.Context, req CreateClusterRequest) (db.Cluster, error) {
	slug := GenerateSlug(req.Name)

	// Get used CIDRs
	usedCIDRs, err := s.queries.ListAllClusterCIDRs(ctx)
	if err != nil {
		return db.Cluster{}, fmt.Errorf("list CIDRs: %w", err)
	}
	var usedStrs []string
	for _, c := range usedCIDRs {
		usedStrs = append(usedStrs, c.String())
	}

	cidr, err := s.allocator.AllocateClusterCIDR(usedStrs)
	if err != nil {
		return db.Cluster{}, fmt.Errorf("allocate CIDR: %w", err)
	}

	cluster, err := s.queries.CreateCluster(ctx, db.CreateClusterParams{
		TeamID:      req.TeamID,
		Name:        req.Name,
		Slug:        slug,
		Description: req.Description,
		Region:      req.Region,
		Cidr:        cidr.String(), // adapt to actual pgtype
	})
	if err != nil {
		return db.Cluster{}, fmt.Errorf("create cluster: %w", err)
	}

	return cluster, nil
}

// AddMember adds a server to a cluster and triggers mesh regeneration.
func (s *Service) AddMember(ctx context.Context, req AddMemberRequest) error {
	// 1. Verify server is not in a cluster already
	existing, err := s.queries.GetClusterMemberByServerID(ctx, req.ServerID)
	if err == nil && existing.ID != uuid.Nil {
		return fmt.Errorf("server already in cluster %s", existing.ClusterID)
	}

	// 2. Get cluster for CIDR
	cluster, err := s.queries.GetClusterByID(ctx, db.GetClusterByIDParams{
		ID: req.ClusterID, TeamID: req.TeamID,
	})
	if err != nil {
		return fmt.Errorf("get cluster: %w", err)
	}

	// 3. Allocate WireGuard IP
	usedIPRows, err := s.queries.ListClusterMemberIPs(ctx, req.ClusterID)
	if err != nil {
		return fmt.Errorf("list used IPs: %w", err)
	}
	var usedIPs []string
	for _, ip := range usedIPRows {
		usedIPs = append(usedIPs, ip.String())
	}

	wgIP, err := s.allocator.AllocateServerIP(cluster.Cidr.String(), usedIPs)
	if err != nil {
		return fmt.Errorf("allocate IP: %w", err)
	}

	// 4. Send WireGuardGenerateKeysCommand to agent (via ConnManager)
	// Agent generates keypair, returns public key
	// For now, this is handled asynchronously via the gRPC stream.
	// The public key is received in server.go and stored.

	// 5. Get server for endpoint info
	srv, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{
		ID: req.ServerID, TeamID: req.TeamID,
	})
	if err != nil {
		return fmt.Errorf("get server: %w", err)
	}

	endpoint := fmt.Sprintf("%s:51820", srv.PublicIp)

	// 6. Create member record
	// Note: wireguard_public_key is initially empty, updated when agent responds
	_, err = s.queries.CreateClusterMember(ctx, db.CreateClusterMemberParams{
		ClusterID:          req.ClusterID,
		ServerID:           req.ServerID,
		WireguardIp:        wgIP.String(), // adapt to pgtype
		WireguardPublicKey: "",            // populated after agent keygen
		WireguardEndpoint:  endpoint,
		ListenPort:         51820,
	})
	if err != nil {
		return fmt.Errorf("create member: %w", err)
	}

	// 7. Trigger WireGuard key generation on agent
	// 8. After key is received (async), mesh regeneration is triggered

	return nil
}

// RemoveMember removes a server from a cluster and triggers mesh regeneration.
func (s *Service) RemoveMember(ctx context.Context, teamID, clusterID, serverID uuid.UUID) error {
	// 1. Delete member
	if err := s.queries.DeleteClusterMember(ctx, db.DeleteClusterMemberParams{
		ClusterID: clusterID, ServerID: serverID,
	}); err != nil {
		return fmt.Errorf("delete member: %w", err)
	}

	// 2. Clear server.cluster_id
	// (handled by the ON DELETE SET NULL on the FK, but also update explicitly)

	// 3. Send WireGuardTeardownCommand to removed server's agent

	// 4. Regenerate mesh for remaining members
	if err := s.meshManager.RegenerateMesh(ctx, clusterID); err != nil {
		s.logger.Error("mesh regeneration failed after member removal", "error", err)
	}

	return nil
}

// DeleteCluster deletes a cluster if it has no members.
func (s *Service) DeleteCluster(ctx context.Context, teamID, clusterID uuid.UUID) error {
	count, err := s.queries.CountClusterMembers(ctx, clusterID)
	if err != nil {
		return fmt.Errorf("count members: %w", err)
	}
	if count > 0 {
		return fmt.Errorf("cluster has %d members, remove all servers before deleting", count)
	}

	return s.queries.DeleteCluster(ctx, db.DeleteClusterParams{
		ID: clusterID, TeamID: teamID,
	})
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./cluster/
```

- [ ] **Step 3: Commit**

```bash
git add internal/cluster/service.go
git commit -m "feat: add cluster service with CRUD and member management"
```

---

## Task 10: Extend Agent Protocol

**Files:**
- Modify: `proto/agent/v1/agent.proto`
- Regenerate: `internal/agent/proto/agent/v1/*.pb.go`

- [ ] **Step 1: Add new messages to proto file**

Add after `SSHKeyInstallResult`:

```protobuf
// --- Phase 2: WireGuard + Mesh + DNS ---

message WireGuardGenerateKeysCommand {
  string request_id = 1;
}

message WireGuardGenerateKeysResult {
  string request_id = 1;
  string public_key = 2;
  bool success = 3;
  string error = 4;
}

message WireGuardApplyConfigCommand {
  string request_id = 1;
  string config = 2;
  string private_key_path = 3;
  bool sync_only = 4;
}

message WireGuardApplyConfigResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}

message WireGuardTeardownCommand {
  string request_id = 1;
}

message WireGuardTeardownResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}

message PeerHealth {
  string public_key = 1;
  string wireguard_ip = 2;
  bool reachable = 3;
  int32 rtt_ms = 4;
  int64 last_handshake_unix = 5;
  int64 rx_bytes = 6;
  int64 tx_bytes = 7;
}

message MeshHealthReport {
  string agent_id = 1;
  repeated PeerHealth peers = 2;
}

message DNSRecord {
  string hostname = 1;
  string ip = 2;
}

message DNSUpdateHostsCommand {
  string request_id = 1;
  string cluster_slug = 2;
  repeated DNSRecord records = 3;
  string corefile = 4;
  bool initial_setup = 5;
}

message DNSUpdateHostsResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}
```

- [ ] **Step 2: Update AgentMessage oneof**

Add fields 8-12:
```protobuf
WireGuardGenerateKeysResult wireguard_keys_result = 8;
WireGuardApplyConfigResult wireguard_config_result = 9;
WireGuardTeardownResult wireguard_teardown_result = 10;
MeshHealthReport mesh_health_report = 11;
DNSUpdateHostsResult dns_update_result = 12;
```

- [ ] **Step 3: Update ControlMessage oneof**

Add fields 6-9:
```protobuf
WireGuardGenerateKeysCommand wireguard_generate_keys = 6;
WireGuardApplyConfigCommand wireguard_apply_config = 7;
WireGuardTeardownCommand wireguard_teardown = 8;
DNSUpdateHostsCommand dns_update_hosts = 9;
```

- [ ] **Step 4: Regenerate Go code**

```bash
cd proto && protoc --go_out=../internal/agent/proto --go_opt=paths=source_relative \
  --go-grpc_out=../internal/agent/proto --go-grpc_opt=paths=source_relative \
  -I. -I/opt/homebrew/include \
  agent/v1/agent.proto
```

- [ ] **Step 5: Verify it compiles**

```bash
cd internal && go build ./agent/...
```

- [ ] **Step 6: Commit**

```bash
git add proto/ internal/agent/proto/
git commit -m "feat: extend agent protocol with WireGuard, mesh health, and DNS messages"
```

---

## Task 11: Config — Add WireGuard Settings

**Files:**
- Modify: `internal/config/config.go`

- [ ] **Step 1: Add WireGuard config to Config struct**

Add to `Config` struct:
```go
type Config struct {
	Server   ServerConfig
	Database DatabaseConfig
	Redis    RedisConfig
	Auth     AuthConfig
	Email    EmailConfig
	Crypto   CryptoConfig
	WireGuard WireGuardConfig
}

type WireGuardConfig struct {
	PoolCIDR        string // Default: "10.100.0.0/10"
	DefaultPort     int    // Default: 51820
	HealthInterval  int    // Default: 30 (seconds)
}
```

Add defaults in `Load()`:
```go
v.SetDefault("wireguard.pool_cidr", "10.100.0.0/10")
v.SetDefault("wireguard.default_port", 51820)
v.SetDefault("wireguard.health_interval", 30)
// ...
cfg.WireGuard.PoolCIDR = v.GetString("wireguard.pool_cidr")
cfg.WireGuard.DefaultPort = v.GetInt("wireguard.default_port")
cfg.WireGuard.HealthInterval = v.GetInt("wireguard.health_interval")
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./config/
```

- [ ] **Step 3: Commit**

```bash
git add internal/config/config.go
git commit -m "feat: add WireGuard pool CIDR and port settings to config"
```

---

## Task 12: Agent — WireGuard Management

**Files:**
- Create: `apps/agent/wireguard.go`
- Create: `apps/agent/meshhealth.go`
- Create: `apps/agent/dnshandler.go`
- Modify: `apps/agent/client.go`

- [ ] **Step 1: Write WireGuard handler**

`apps/agent/wireguard.go` — handles key generation, config application, and teardown on the agent side.

```go
// Key generation
func handleWireGuardGenerateKeys(requestID string) *agentv1.WireGuardGenerateKeysResult {
	// 1. Install wireguard-tools if not present
	// 2. wg genkey > /etc/wireguard/wg0.key
	// 3. wg pubkey < /etc/wireguard/wg0.key → capture public key
	// 4. Return public key
}

// Config application
func handleWireGuardApplyConfig(cmd *agentv1.WireGuardApplyConfigCommand) *agentv1.WireGuardApplyConfigResult {
	// 1. Replace PRIVATE_KEY_PLACEHOLDER with actual private key from file
	// 2. Write config to /etc/wireguard/wg0.conf
	// 3. If sync_only: wg syncconf wg0 <(wg-quick strip wg0)
	// 4. Else: wg-quick down wg0 (ignore error if not up), wg-quick up wg0
	// 5. Enable wg-quick@wg0.service for auto-start on boot
}

// Teardown
func handleWireGuardTeardown(requestID string) *agentv1.WireGuardTeardownResult {
	// 1. wg-quick down wg0
	// 2. Remove /etc/wireguard/wg0.conf and /etc/wireguard/wg0.key
	// 3. Disable wg-quick@wg0.service
}
```

- [ ] **Step 2: Write mesh health checker**

`apps/agent/meshhealth.go` — background goroutine that runs every 30s when the agent is in a cluster:

```go
func (a *Agent) runMeshHealthLoop(ctx context.Context) {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			report := a.collectMeshHealth()
			if report != nil {
				a.sendMessage(&agentv1.AgentMessage{
					Payload: &agentv1.AgentMessage_MeshHealthReport{
						MeshHealthReport: report,
					},
				})
			}
		}
	}
}

func (a *Agent) collectMeshHealth() *agentv1.MeshHealthReport {
	// 1. Run "wg show wg0 dump" → parse peers, handshakes, transfer
	// 2. For each peer, ping the WireGuard IP: "ping -c 1 -W 2 <ip>"
	// 3. Build PeerHealth for each
}
```

- [ ] **Step 3: Write DNS handler**

`apps/agent/dnshandler.go` — handles `DNSUpdateHostsCommand`:

```go
func handleDNSUpdate(cmd *agentv1.DNSUpdateHostsCommand) *agentv1.DNSUpdateHostsResult {
	// 1. Write hosts file to /etc/coredns/hosts
	// 2. If initial_setup:
	//    a. Write Corefile to /etc/coredns/Corefile
	//    b. Deploy CoreDNS container (docker run ...)
	//    c. Update /etc/resolv.conf
	// 3. CoreDNS auto-reloads on hosts file change
}
```

- [ ] **Step 4: Update client.go to handle new ControlMessage types**

Add cases in the message receive loop for:
- `WireGuardGenerateKeysCommand` → call `handleWireGuardGenerateKeys()`
- `WireGuardApplyConfigCommand` → call `handleWireGuardApplyConfig()`
- `WireGuardTeardownCommand` → call `handleWireGuardTeardown()`
- `DNSUpdateHostsCommand` → call `handleDNSUpdate()`

- [ ] **Step 5: Verify agent compiles and cross-compiles**

```bash
cd apps/agent && go build .
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags='-s -w' -o bin/agent-linux-amd64 .
```

- [ ] **Step 6: Commit**

```bash
git add apps/agent/
git commit -m "feat: add WireGuard management, mesh health checks, and DNS handling to agent"
```

---

## Task 13: Update Agent Server (Control Plane Side)

**Files:**
- Modify: `internal/agent/server.go`
- Modify: `internal/agent/connmanager.go`

- [ ] **Step 1: Add new message handlers to server.go**

Add cases in the `Connect()` switch for:

```go
case *agentv1.AgentMessage_WireguardKeysResult:
	kr := p.WireguardKeysResult
	s.logger.Info("wireguard keys generated",
		"agent_id", agentID,
		"request_id", kr.RequestId,
		"success", kr.Success,
	)
	s.handleWireGuardKeysResult(stream.Context(), agentID, kr)

case *agentv1.AgentMessage_WireguardConfigResult:
	cr := p.WireguardConfigResult
	s.logger.Info("wireguard config applied",
		"agent_id", agentID,
		"request_id", cr.RequestId,
		"success", cr.Success,
	)

case *agentv1.AgentMessage_WireguardTeardownResult:
	tr := p.WireguardTeardownResult
	s.logger.Info("wireguard teardown",
		"agent_id", agentID,
		"request_id", tr.RequestId,
		"success", tr.Success,
	)

case *agentv1.AgentMessage_MeshHealthReport:
	mhr := p.MeshHealthReport
	s.handleMeshHealthReport(stream.Context(), agentID, mhr)

case *agentv1.AgentMessage_DnsUpdateResult:
	dr := p.DnsUpdateResult
	s.logger.Info("dns update result",
		"agent_id", agentID,
		"request_id", dr.RequestId,
		"success", dr.Success,
	)
```

- [ ] **Step 2: Implement handleWireGuardKeysResult**

When the agent returns a public key after key generation:
1. Find the `cluster_member` row for this agent_id
2. Update `wireguard_public_key` with the returned key
3. Trigger mesh regeneration for the cluster

- [ ] **Step 3: Implement handleMeshHealthReport**

Process the health report:
1. Find the cluster member for this agent
2. For each PeerHealth entry, look up the peer by public_key or wireguard_ip
3. Update `wireguard_peers` table with status, RTT, handshake time
4. Derive and update cluster status
5. Log mesh events on status transitions

- [ ] **Step 4: Add mesh health tracking to ConnManager**

Add `MeshHealth` field to `ConnState` to cache latest health report.

- [ ] **Step 5: Verify it compiles**

```bash
cd internal && go build ./agent/
```

- [ ] **Step 6: Commit**

```bash
git add internal/agent/server.go internal/agent/connmanager.go
git commit -m "feat: handle WireGuard, mesh health, and DNS messages in agent server"
```

---

## Task 14: API Handlers — Cluster CRUD

**Files:**
- Create: `internal/api/handler/cluster.go`

- [ ] **Step 1: Write cluster handler**

Follow the existing handler pattern from `server_handler.go`:

```go
package handler

import (
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/othmanhaba/nixway-core/internal/api/middleware"
	"github.com/othmanhaba/nixway-core/internal/api/respond"
	"github.com/othmanhaba/nixway-core/internal/audit"
	"github.com/othmanhaba/nixway-core/internal/cluster"
	"github.com/othmanhaba/nixway-core/internal/db"
)

type ClusterHandler struct {
	queries    *db.Queries
	audit      *audit.Writer
	clusterSvc *cluster.Service
	logger     *slog.Logger
}

func NewClusterHandler(queries *db.Queries, auditWriter *audit.Writer, clusterSvc *cluster.Service, logger *slog.Logger) *ClusterHandler {
	return &ClusterHandler{
		queries:    queries,
		audit:      auditWriter,
		clusterSvc: clusterSvc,
		logger:     logger,
	}
}

type createClusterRequest struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Region      string `json:"region"`
}

func (h *ClusterHandler) Create(w http.ResponseWriter, r *http.Request) {
	authCtx := middleware.GetAuthContext(r)
	if authCtx == nil {
		respond.Error(w, http.StatusUnauthorized, "authentication required")
		return
	}

	teamID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid team ID")
		return
	}

	var req createClusterRequest
	if err := respond.DecodeJSON(r, &req); err != nil {
		respond.Error(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if req.Name == "" {
		respond.Error(w, http.StatusBadRequest, "name is required")
		return
	}

	c, err := h.clusterSvc.CreateCluster(r.Context(), cluster.CreateClusterRequest{
		TeamID:      teamID,
		Name:        req.Name,
		Description: req.Description,
		Region:      req.Region,
	})
	if err != nil {
		h.logger.Error("failed to create cluster", "error", err)
		respond.Error(w, http.StatusUnprocessableEntity, err.Error())
		return
	}

	ip := parseIP(r)
	_ = h.audit.Log(r.Context(), audit.Entry{
		TeamID:       &teamID,
		ActorID:      &authCtx.UserID,
		ActorType:    "user",
		Action:       "cluster.create",
		ResourceType: "cluster",
		ResourceID:   &c.ID,
		IPAddress:    ip,
	})

	respond.JSON(w, http.StatusCreated, c)
}

// List, Get, Update, Delete follow the same pattern as ServerHandler.
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./api/handler/
```

- [ ] **Step 3: Commit**

```bash
git add internal/api/handler/cluster.go
git commit -m "feat: add cluster CRUD handlers"
```

---

## Task 15: API Handlers — Cluster Members

**Files:**
- Create: `internal/api/handler/cluster_member.go`

- [ ] **Step 1: Write cluster member handler**

```go
type ClusterMemberHandler struct {
	queries    *db.Queries
	audit      *audit.Writer
	clusterSvc *cluster.Service
	logger     *slog.Logger
}

// AddMember — POST /api/v1/teams/{id}/clusters/{clusterId}/members
// Body: {"server_id": "uuid"}
func (h *ClusterMemberHandler) Add(w http.ResponseWriter, r *http.Request) { ... }

// RemoveMember — DELETE /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}
func (h *ClusterMemberHandler) Remove(w http.ResponseWriter, r *http.Request) { ... }

// ListMembers — GET /api/v1/teams/{id}/clusters/{clusterId}/members
func (h *ClusterMemberHandler) List(w http.ResponseWriter, r *http.Request) { ... }
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./api/handler/
```

- [ ] **Step 3: Commit**

```bash
git add internal/api/handler/cluster_member.go
git commit -m "feat: add cluster member add/remove/list handlers"
```

---

## Task 16: API Handlers — Mesh Health + Events

**Files:**
- Create: `internal/api/handler/mesh.go`

- [ ] **Step 1: Write mesh handler**

```go
type MeshHandler struct {
	queries    *db.Queries
	clusterSvc *cluster.Service
	meshMgr    *mesh.Manager
	logger     *slog.Logger
}

// Health — GET /api/v1/teams/{id}/clusters/{clusterId}/health
// Returns: N x N matrix of peer link statuses
func (h *MeshHandler) Health(w http.ResponseWriter, r *http.Request) {
	// 1. List all cluster members
	// 2. List all peer links for this cluster
	// 3. Build matrix response:
	// {
	//   "members": [{"id": "...", "server_name": "...", "wireguard_ip": "..."}],
	//   "links": [{"from": "member_id", "to": "peer_member_id", "status": "...", "rtt_ms": N}]
	// }
}

// RotateKeys — POST /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}/rotate-keys
func (h *MeshHandler) RotateKeys(w http.ResponseWriter, r *http.Request) { ... }

// Regenerate — POST /api/v1/teams/{id}/clusters/{clusterId}/regenerate
func (h *MeshHandler) Regenerate(w http.ResponseWriter, r *http.Request) { ... }

// Events — GET /api/v1/teams/{id}/clusters/{clusterId}/events?limit=50&offset=0
func (h *MeshHandler) Events(w http.ResponseWriter, r *http.Request) { ... }

// DNS — GET /api/v1/teams/{id}/clusters/{clusterId}/dns
func (h *MeshHandler) DNS(w http.ResponseWriter, r *http.Request) { ... }
```

- [ ] **Step 2: Verify it compiles**

```bash
cd internal && go build ./api/handler/
```

- [ ] **Step 3: Commit**

```bash
git add internal/api/handler/mesh.go
git commit -m "feat: add mesh health, key rotation, events, and DNS handlers"
```

---

## Task 17: Router + Wiring

**Files:**
- Modify: `internal/api/router.go`
- Modify: `apps/api/main.go`

- [ ] **Step 1: Register new routes in router.go**

Update `NewRouter` signature to accept cluster, mesh services. Add handler constructors and routes:

```go
// Add to NewRouter parameters:
// clusterSvc *cluster.Service, meshMgr *mesh.Manager

clusterH := handler.NewClusterHandler(queries, auditWriter, clusterSvc, logger)
memberH := handler.NewClusterMemberHandler(queries, auditWriter, clusterSvc, logger)
meshH := handler.NewMeshHandler(queries, clusterSvc, meshMgr, logger)

// Clusters
protected.HandleFunc("POST /api/v1/teams/{id}/clusters", clusterH.Create)
protected.HandleFunc("GET /api/v1/teams/{id}/clusters", clusterH.List)
protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Get)
protected.HandleFunc("PUT /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Update)
protected.HandleFunc("DELETE /api/v1/teams/{id}/clusters/{clusterId}", clusterH.Delete)

// Cluster Members
protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/members", memberH.Add)
protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/members", memberH.List)
protected.HandleFunc("DELETE /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}", memberH.Remove)

// Mesh Operations
protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/health", meshH.Health)
protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}/rotate-keys", meshH.RotateKeys)
protected.HandleFunc("POST /api/v1/teams/{id}/clusters/{clusterId}/regenerate", meshH.Regenerate)
protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/events", meshH.Events)
protected.HandleFunc("GET /api/v1/teams/{id}/clusters/{clusterId}/dns", meshH.DNS)
```

- [ ] **Step 2: Wire in apps/api/main.go**

Instantiate:
1. `CIDRAllocator` from config `WireGuard.PoolCIDR`
2. `dns.Manager`
3. `mesh.Manager` with queries, connManager, dnsManager
4. `cluster.Service` with queries, allocator, meshManager
5. Pass to `NewRouter`

- [ ] **Step 3: Verify it compiles**

```bash
cd internal && go build ./...
cd apps/api && go build .
```

- [ ] **Step 4: Commit**

```bash
git add internal/api/router.go apps/api/main.go
git commit -m "feat: register Phase 2 cluster and mesh routes, wire dependencies"
```

---

## Task 18: Web UI — Cluster List Page

**Files:**
- Create: `apps/web/src/routes/_app/clusters.$teamId.tsx`

- [ ] **Step 1: Add types to lib**

Add to types file: `Cluster`, `ClusterMember`, `PeerLink`, `MeshHealthMatrix`, `MeshEvent`, `DNSRecord`

```typescript
export interface Cluster {
  id: string
  team_id: string
  name: string
  slug: string
  description: string
  region: string
  cidr: string
  status: 'active' | 'degraded' | 'error'
  created_at: string
  updated_at: string
}

export interface ClusterMember {
  id: string
  cluster_id: string
  server_id: string
  server_name: string
  public_ip: string
  server_status: string
  wireguard_ip: string
  wireguard_public_key: string
  wireguard_endpoint: string
  listen_port: number
  joined_at: string
}

export interface PeerLink {
  from: string
  to: string
  status: 'pending' | 'active' | 'degraded' | 'failed'
  rtt_ms: number | null
  last_handshake_at: string | null
}

export interface MeshEvent {
  id: string
  cluster_id: string
  event_type: string
  member_id: string | null
  details: Record<string, unknown>
  created_at: string
}
```

- [ ] **Step 2: Build cluster list page**

Route: `/teams/:teamId/clusters`
- TanStack Table with columns: Name, Region, Status (badge), Members (count), CIDR, Created
- Status badge colors: green (active), yellow (degraded), red (error)
- "Create Cluster" button → dialog with Name, Description, Region fields
- Click row → navigate to cluster detail

- [ ] **Step 3: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/
git commit -m "feat: add cluster list page with create dialog"
```

---

## Task 19: Web UI — Cluster Detail Page + Mesh Health Matrix

**Files:**
- Create: `apps/web/src/routes/_app/clusters_.$teamId.$clusterId.tsx`
- Create: `apps/web/src/components/mesh-health-matrix.tsx`

- [ ] **Step 1: Build mesh health matrix component**

`apps/web/src/components/mesh-health-matrix.tsx`:
- N x N grid where rows and columns are cluster members
- Each cell shows the link status between two nodes
- Color coding: green (active), yellow (degraded), red (failed), gray (self/diagonal)
- Hover on cell shows tooltip with: RTT, last handshake, rx/tx bytes
- Auto-refreshes every 30 seconds via polling

```tsx
interface MeshHealthMatrixProps {
  members: ClusterMember[]
  links: PeerLink[]
}

function MeshHealthMatrix({ members, links }: MeshHealthMatrixProps) {
  const linkMap = useMemo(() => {
    const map = new Map<string, PeerLink>()
    for (const link of links) {
      map.set(`${link.from}-${link.to}`, link)
    }
    return map
  }, [links])

  return (
    <div className="overflow-auto">
      <table>
        <thead>
          <tr>
            <th />
            {members.map(m => <th key={m.id}>{m.server_name}</th>)}
          </tr>
        </thead>
        <tbody>
          {members.map(from => (
            <tr key={from.id}>
              <td>{from.server_name}</td>
              {members.map(to => {
                if (from.id === to.id) return <td key={to.id} className="bg-gray-200" />
                const link = linkMap.get(`${from.id}-${to.id}`)
                const color = statusColor(link?.status)
                return <td key={to.id} className={color} title={formatTooltip(link)} />
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 2: Build cluster detail page**

Route: `/teams/:teamId/clusters/:clusterId`
- Tabs: Overview, Members, Mesh Health, DNS, Events

**Overview Tab:** Name, slug, description, region, CIDR, status, member count, healthy/total links

**Members Tab:** Table of members with Add/Remove buttons. Add shows dropdown of available servers (those without a cluster).

**Mesh Health Tab:** The `MeshHealthMatrix` component.

**DNS Tab:** Table of hostname → IP records.

**Events Tab:** Timeline list of mesh events with type badges and timestamps.

- [ ] **Step 3: Add nav links**

Update app layout sidebar to include "Clusters" link alongside "Servers".

- [ ] **Step 4: Verify build**

```bash
cd apps/web && pnpm build
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/
git commit -m "feat: add cluster detail page with mesh health matrix, DNS, and events tabs"
```

---

## Task 20: Integration Tests

**Files:**
- Create: `tests/integration/cluster_test.go`
- Create: `tests/integration/mesh_test.go`

- [ ] **Step 1: Write cluster CRUD integration tests**

Test via API:
1. Create cluster → verify CIDR auto-assigned, slug generated
2. List clusters → verify it appears
3. Get cluster → verify all fields
4. Update cluster name/description → verify updated
5. Delete empty cluster → verify success
6. Delete non-empty cluster → verify error

- [ ] **Step 2: Write member management integration tests**

1. Add server to cluster → verify member record created, WireGuard IP assigned
2. Add same server to another cluster → verify error (one cluster constraint)
3. List members → verify correct
4. Remove member → verify removed
5. Add 3 servers → verify sequential IPs (.1, .2, .3)

- [ ] **Step 3: Write CIDR allocation integration tests**

1. Create 3 clusters → verify unique CIDRs (10.100.0.0/16, 10.101.0.0/16, 10.102.0.0/16)
2. Delete middle cluster → create new → verify it gets 10.101.0.0/16 (reuse)

- [ ] **Step 4: Write mesh health integration tests**

1. Simulate MeshHealthReport → verify peer status updates in DB
2. Test status transitions: active → degraded → failed → active
3. Test cluster status derivation from peer statuses

- [ ] **Step 5: Write mesh event integration tests**

1. Add/remove members → verify mesh events logged
2. List events with pagination → verify correct ordering

- [ ] **Step 6: Run all tests**

```bash
cd tests && go test -v ./integration/ -count=1 -timeout 5m
```

- [ ] **Step 7: Commit**

```bash
git add tests/
git commit -m "test: add cluster, mesh, and networking integration tests"
```

---

## Task 21: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd internal && go test ./... -count=1
cd tests && go test -v ./integration/ -count=1 -timeout 5m
cd apps/web && pnpm build
```

- [ ] **Step 2: Build all apps**

```bash
go build ./apps/api && go build ./apps/agent
```

- [ ] **Step 3: Verify migration applies cleanly**

```bash
goose -dir sql/migrations postgres "$DATABASE_URL" up
goose -dir sql/migrations postgres "$DATABASE_URL" down
goose -dir sql/migrations postgres "$DATABASE_URL" up
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat: complete Phase 2 Clusters + Private Networking — all components built and verified"
```

---

## Exit Criteria Checklist

| # | Criterion | Test |
|---|-----------|------|
| 1 | Cluster created, 3 servers attached, mesh comes up within 60 seconds | `cluster_test.go` + manual verify |
| 2 | Every server can ping every other server via WireGuard IP | Manual verify on real servers |
| 3 | DNS resolves: `dig server-b.mycluster.internal` returns correct WireGuard IP | Manual verify on real servers |
| 4 | Adding a 4th server: all existing nodes get updated peer config within 60 seconds | `cluster_test.go` + manual verify |
| 5 | Removing a server: peer revoked everywhere within 60 seconds | `cluster_test.go` + manual verify |
| 6 | Rebooting a node: mesh restores automatically on boot | Manual verify (wg-quick@wg0.service) |
| 7 | Simulated link failure surfaces as broken link in UI with affected peer identified | `mesh_test.go` + manual UI verify |
| 8 | Key rotation regenerates keys and updates mesh without downtime | Manual verify with traffic test |
