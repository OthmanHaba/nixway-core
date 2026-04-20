# Phase 2: Clusters + Private Networking — Design Spec

**Project:** Nixway PaaS Platform
**Phase:** 2 — Clusters + Private Networking
**Date:** 2026-04-19
**Builds on:** Phase 1 (Server Management)

---

## Overview

Phase 2 introduces cluster management and private networking between servers. Servers are grouped into clusters, each assigned a private CIDR block. WireGuard mesh networking connects all servers within a cluster, enabling private IP communication. CoreDNS provides cluster-internal DNS resolution (`<server>.<cluster>.internal`). The control plane orchestrates mesh configuration, monitors link health, and auto-repairs on topology changes.

---

## New Database Tables

### `clusters`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| team_id | UUID | FK → teams, NOT NULL |
| name | TEXT | NOT NULL |
| slug | TEXT | NOT NULL (lowercase, hyphenated, unique per team) |
| description | TEXT | DEFAULT '' |
| region | TEXT | DEFAULT '' (free-form label) |
| cidr | CIDR | NOT NULL (auto-assigned, e.g. `10.100.0.0/16`) |
| status | TEXT | NOT NULL DEFAULT 'active' |
| created_at | TIMESTAMPTZ | DEFAULT now() |
| updated_at | TIMESTAMPTZ | DEFAULT now() |

Status values: `active`, `degraded`, `error`

Constraints:
- `UNIQUE(team_id, slug)` — cluster slugs unique within a team
- `UNIQUE(cidr)` — each cluster gets a unique CIDR

### `cluster_members`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| cluster_id | UUID | FK → clusters ON DELETE CASCADE |
| server_id | UUID | FK → servers ON DELETE CASCADE, UNIQUE (one cluster per server) |
| wireguard_ip | INET | NOT NULL (assigned from cluster CIDR) |
| wireguard_public_key | TEXT | NOT NULL |
| wireguard_endpoint | TEXT | NOT NULL (server public_ip:listen_port) |
| listen_port | INT | NOT NULL DEFAULT 51820 |
| joined_at | TIMESTAMPTZ | DEFAULT now() |

Constraints:
- `UNIQUE(server_id)` — a server belongs to exactly one cluster at a time
- `UNIQUE(cluster_id, wireguard_ip)` — no duplicate IPs within a cluster

### `wireguard_peers`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| member_id | UUID | FK → cluster_members ON DELETE CASCADE |
| peer_member_id | UUID | FK → cluster_members ON DELETE CASCADE |
| status | TEXT | NOT NULL DEFAULT 'pending' |
| last_handshake_at | TIMESTAMPTZ | nullable |
| last_check_at | TIMESTAMPTZ | nullable |
| rtt_ms | INT | nullable (round-trip time in ms) |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Status values: `pending`, `active`, `degraded`, `failed`

This table represents directed peer links. For a full mesh of N nodes, there are N*(N-1) rows (each node peers with every other node). The `member_id` is "from" and `peer_member_id` is "to".

### `mesh_events`
| Column | Type | Notes |
|--------|------|-------|
| id | UUID | PK, gen_random_uuid() |
| cluster_id | UUID | FK → clusters ON DELETE CASCADE |
| event_type | TEXT | NOT NULL |
| member_id | UUID | nullable, FK → cluster_members |
| details | JSONB | event-specific payload |
| created_at | TIMESTAMPTZ | DEFAULT now() |

Event types: `member_added`, `member_removed`, `mesh_regenerated`, `key_rotated`, `link_failure`, `link_restored`, `dns_updated`

### `servers` (modification)

Add column:
| Column | Type | Notes |
|--------|------|-------|
| cluster_id | UUID | nullable, FK → clusters ON DELETE SET NULL |

This is a denormalized convenience column — the canonical membership is in `cluster_members`, but having `cluster_id` on the server simplifies queries and enforces the one-cluster constraint at the DB level.

---

## 1. Cluster Management

### Cluster CRUD

**Create:** User provides name, optional description, optional region label. Platform auto-generates:
- `slug`: lowercase, hyphenated version of name (e.g. "My Cluster" → "my-cluster")
- `cidr`: next available /16 from the platform CIDR pool

**Update:** name, description, region are mutable. slug and CIDR are immutable after creation.

**Delete:** Only allowed if cluster has zero members. Cascade-deletes mesh_events. Returns CIDR to pool.

### API Endpoints
```
POST   /api/v1/teams/{id}/clusters                  — create cluster
GET    /api/v1/teams/{id}/clusters                  — list clusters
GET    /api/v1/teams/{id}/clusters/{clusterId}      — get cluster detail
PUT    /api/v1/teams/{id}/clusters/{clusterId}      — update cluster
DELETE /api/v1/teams/{id}/clusters/{clusterId}      — delete cluster (must be empty)
```

---

## 2. Server-to-Cluster Assignment

### Add Server to Cluster

1. Validate server belongs to the team and is not already in a cluster
2. Allocate the next available WireGuard IP from the cluster's /16 CIDR (first host IP starts at .1, sequential)
3. Send `WireGuardGenerateKeys` command to the server's agent via gRPC
4. Agent generates WireGuard keypair locally — **private key never leaves the node**
5. Agent returns public key to control plane
6. Create `cluster_members` record
7. Update `servers.cluster_id`
8. Trigger mesh regeneration (see section 3)

### Remove Server from Cluster

1. Remove `cluster_members` record
2. Set `servers.cluster_id` to NULL
3. Send `WireGuardTeardown` command to the removed server's agent
4. Trigger mesh regeneration for remaining members
5. Log `member_removed` mesh event

### API Endpoints
```
POST   /api/v1/teams/{id}/clusters/{clusterId}/members              — add server {server_id}
DELETE /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}   — remove server
GET    /api/v1/teams/{id}/clusters/{clusterId}/members              — list members
```

---

## 3. WireGuard Mesh Auto-Configuration

### Topology

Full mesh: every node in the cluster peers with every other node. For N nodes, each node has N-1 peers. This is simple and works well up to ~50 nodes per cluster (v1 constraint).

### Key Management

- Agent generates WireGuard keypair using `wg genkey` / `wg pubkey`
- Private key stored only on the agent's filesystem at `/etc/wireguard/wg0.key`
- Public key sent to control plane, stored in `cluster_members.wireguard_public_key`
- Control plane never sees or stores private keys

### Configuration Generation

When mesh regeneration is triggered (node add/remove/key rotation), the control plane:

1. Fetches all cluster members from DB
2. For each member, generates a WireGuard config containing:
   - Its own `Address` (wireguard_ip/32)
   - `ListenPort` (default 51820)
   - `PrivateKey` reference (path to key file on node)
   - A `[Peer]` block for every other member:
     - `PublicKey` from DB
     - `AllowedIPs`: peer's wireguard_ip/32
     - `Endpoint`: peer's public_ip:listen_port
     - `PersistentKeepalive`: 25 (seconds)
3. Sends `WireGuardApplyConfig` command to each agent via gRPC
4. Agent writes config to `/etc/wireguard/wg0.conf` and applies via `wg-quick down wg0 && wg-quick up wg0` (or `wg syncconf wg0` for zero-downtime updates on existing interfaces)

### Config Template (generated per node)

```ini
[Interface]
Address = 10.100.0.1/32
ListenPort = 51820
PrivateKey = <read from /etc/wireguard/wg0.key>
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o eth0 -j MASQUERADE

[Peer]
PublicKey = <peer_public_key>
AllowedIPs = 10.100.0.2/32
Endpoint = 203.0.113.2:51820
PersistentKeepalive = 25

[Peer]
PublicKey = <peer_public_key>
AllowedIPs = 10.100.0.3/32
Endpoint = 203.0.113.3:51820
PersistentKeepalive = 25
```

### Mesh Regeneration Triggers

- Node added to cluster
- Node removed from cluster
- Key rotation requested
- Link failure that requires config update

---

## 4. CIDR Allocation

### Platform Pool

The platform maintains a global pool: `10.100.0.0/10` (covers `10.100.0.0` through `10.127.255.255`).

### Cluster Allocation

Each cluster receives a /16 from the pool:
- First cluster: `10.100.0.0/16`
- Second cluster: `10.101.0.0/16`
- Third cluster: `10.102.0.0/16`
- ... up to `10.127.0.0/16` (28 clusters maximum; expandable by widening the pool)

### Server Allocation Within Cluster

Each server in a cluster gets a /32 from the cluster's /16:
- First server: `10.100.0.1/32`
- Second server: `10.100.0.2/32`
- ... up to `10.100.255.254/32` (65,534 addresses per cluster)

### Allocation Algorithm

```go
type CIDRAllocator struct {
    pool    net.IPNet       // 10.100.0.0/10
    used    map[string]bool // track used /16 CIDRs
}

func (a *CIDRAllocator) AllocateClusterCIDR() (net.IPNet, error)
func (a *CIDRAllocator) AllocateServerIP(clusterCIDR net.IPNet, usedIPs []net.IP) (net.IP, error)
func (a *CIDRAllocator) ReleaseClusterCIDR(cidr net.IPNet)
```

The allocator queries existing clusters from DB to determine used CIDRs, then picks the next available /16. For server IPs, it queries existing cluster members and picks the next sequential IP.

---

## 5. Private DNS (CoreDNS)

### Architecture

- CoreDNS runs as a Docker container on each cluster member
- Listens on the node's WireGuard IP (e.g. `10.100.0.1:53`)
- Serves the zone `<cluster-slug>.internal`
- Each node's `/etc/resolv.conf` is updated to include the local CoreDNS as a nameserver

### DNS Records

Auto-registered on mesh changes:
- `<server-name>.<cluster-slug>.internal` → server's WireGuard IP (A record)
- Future (Phase 4): `<service-name>.<cluster-slug>.internal` → service load balancer IP

### CoreDNS Configuration

Deployed via a provisioning-style script pushed to agents. The Corefile:

```
<cluster-slug>.internal {
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
```

The `/etc/coredns/hosts` file is managed by the agent:

```
10.100.0.1  server-a.mycluster.internal
10.100.0.2  server-b.mycluster.internal
10.100.0.3  server-c.mycluster.internal
```

### DNS Update Flow

1. Mesh regeneration triggers DNS update
2. Control plane sends `DNSUpdateHosts` command to each agent with the complete hosts list
3. Agent writes hosts file and CoreDNS auto-reloads (file watch)
4. Agent updates `/etc/resolv.conf` to prepend `nameserver <local-wg-ip>`

---

## 6. Agent Protocol Extensions

### New Messages

Add to `proto/agent/v1/agent.proto`:

```protobuf
// WireGuard key generation — control plane asks agent to generate keys
message WireGuardGenerateKeysCommand {
  string request_id = 1;
}

message WireGuardGenerateKeysResult {
  string request_id = 1;
  string public_key = 2;   // Agent returns only the public key
  bool success = 3;
  string error = 4;
}

// WireGuard config application
message WireGuardApplyConfigCommand {
  string request_id = 1;
  string config = 2;        // Full wg0.conf content (without private key line)
  string private_key_path = 3;  // Path to existing private key file
  bool sync_only = 4;       // true = wg syncconf (no downtime), false = full restart
}

message WireGuardApplyConfigResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}

// WireGuard teardown — remove interface
message WireGuardTeardownCommand {
  string request_id = 1;
}

message WireGuardTeardownResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}

// Mesh health check report — agent pings all peers
message MeshHealthReport {
  string agent_id = 1;
  repeated PeerHealth peers = 2;
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

// DNS hosts update
message DNSUpdateHostsCommand {
  string request_id = 1;
  string cluster_slug = 2;
  repeated DNSRecord records = 3;
  string corefile = 4;          // Full Corefile content (only on first setup)
  bool initial_setup = 5;       // true = deploy CoreDNS container + config
}

message DNSRecord {
  string hostname = 1;
  string ip = 2;
}

message DNSUpdateHostsResult {
  string request_id = 1;
  bool success = 2;
  string error = 3;
}
```

### Updated Oneofs

```protobuf
message AgentMessage {
  oneof payload {
    // ... existing fields 1-7 ...
    WireGuardGenerateKeysResult wireguard_keys_result = 8;
    WireGuardApplyConfigResult wireguard_config_result = 9;
    WireGuardTeardownResult wireguard_teardown_result = 10;
    MeshHealthReport mesh_health_report = 11;
    DNSUpdateHostsResult dns_update_result = 12;
  }
}

message ControlMessage {
  oneof payload {
    // ... existing fields 1-5 ...
    WireGuardGenerateKeysCommand wireguard_generate_keys = 6;
    WireGuardApplyConfigCommand wireguard_apply_config = 7;
    WireGuardTeardownCommand wireguard_teardown = 8;
    DNSUpdateHostsCommand dns_update_hosts = 9;
  }
}
```

---

## 7. Mesh Health Monitoring

### Agent-Side Health Check

Every 30 seconds, each agent in a cluster:
1. Runs `wg show wg0 dump` to get peer handshake times and transfer stats
2. Pings each peer's WireGuard IP (`ping -c 1 -W 2 <peer_ip>`)
3. Sends a `MeshHealthReport` to the control plane

### Control Plane Processing

On receiving `MeshHealthReport`:
1. Update `wireguard_peers` table with latest handshake time, RTT, and status
2. Status transitions:
   - `active`: peer reachable, handshake within last 300s
   - `degraded`: peer reachable but handshake older than 300s, or RTT > 500ms
   - `failed`: peer unreachable (3 consecutive failed pings)
3. On status change to `failed`:
   - Log `link_failure` mesh event
   - Attempt auto-repair: re-push config to both affected nodes
   - If failure persists after 2 repair attempts, mark as persistent failure
4. On status change back to `active` from `failed`:
   - Log `link_restored` mesh event

### Cluster Status Derivation

- `active`: all peer links are `active`
- `degraded`: at least one peer link is `degraded` or `failed`, but majority are `active`
- `error`: majority of peer links are `failed`

---

## 8. Auto-Repair

### Triggers and Actions

| Trigger | Action |
|---------|--------|
| Node added | Generate keys on new node, regenerate configs for all nodes, update DNS |
| Node removed | Revoke keys (remove peer blocks), regenerate configs, update DNS |
| Key rotation | Agent generates new keypair, control plane regenerates all configs |
| Link failure | Re-push configs to affected nodes, restart WireGuard if needed |
| Node reboot | Agent brings up wg0 via systemd (wg-quick@wg0.service), mesh auto-restores |

### Key Rotation Flow

1. User triggers key rotation for a specific server (or all servers in cluster)
2. Control plane sends `WireGuardGenerateKeysCommand` to target agent(s)
3. Agent generates new keypair, stores private key, returns new public key
4. Control plane updates `cluster_members.wireguard_public_key`
5. Control plane regenerates and pushes configs to all cluster members
6. Logs `key_rotated` mesh event

### API Endpoints
```
POST /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}/rotate-keys  — rotate WireGuard keys
GET  /api/v1/teams/{id}/clusters/{clusterId}/health                          — mesh health matrix
```

---

## 9. API Endpoints (Complete)

### Clusters
```
POST   /api/v1/teams/{id}/clusters                                          — create cluster
GET    /api/v1/teams/{id}/clusters                                          — list clusters
GET    /api/v1/teams/{id}/clusters/{clusterId}                              — get cluster detail
PUT    /api/v1/teams/{id}/clusters/{clusterId}                              — update cluster
DELETE /api/v1/teams/{id}/clusters/{clusterId}                              — delete cluster
```

### Cluster Members
```
POST   /api/v1/teams/{id}/clusters/{clusterId}/members                      — add server to cluster
DELETE /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}           — remove server
GET    /api/v1/teams/{id}/clusters/{clusterId}/members                      — list members
```

### Mesh Operations
```
GET    /api/v1/teams/{id}/clusters/{clusterId}/health                       — mesh health matrix
POST   /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId}/rotate-keys — rotate WireGuard keys
POST   /api/v1/teams/{id}/clusters/{clusterId}/regenerate                   — force mesh regeneration
GET    /api/v1/teams/{id}/clusters/{clusterId}/events                       — list mesh events
```

### DNS
```
GET    /api/v1/teams/{id}/clusters/{clusterId}/dns                          — list DNS records
```

---

## 10. Web UI Pages

### Cluster List Page
- Route: `/teams/:teamId/clusters`
- Table with columns: Name, Region, Status (badge), Members (count), CIDR, Created
- Status filter (active/degraded/error/all)
- "Create Cluster" button → dialog

### Cluster Detail Page
- Route: `/teams/:teamId/clusters/:clusterId`
- Tabs: Overview, Members, Mesh Health, DNS, Events

**Overview Tab:**
- Name, slug, description, region, CIDR, status
- Member count, mesh link count
- Quick stats: healthy links / total links

**Members Tab:**
- Table: Server Name, WireGuard IP, Public IP, Status, Joined At
- "Add Server" button → dropdown of available servers (not in any cluster)
- Remove server button with confirmation

**Mesh Health Tab:**
- N x N matrix grid showing link health between all nodes
- Color-coded cells: green (active), yellow (degraded), red (failed), gray (self)
- Click a cell to see: RTT, last handshake, rx/tx bytes
- Auto-refreshes every 30 seconds

**DNS Tab:**
- Table: Hostname, IP, Type (A)
- Shows all `<server>.<cluster>.internal` records

**Events Tab:**
- Timeline of mesh events (member added/removed, key rotated, link failure/restore)
- Filterable by event type and date range

### Create Cluster Dialog
- Fields: Name, Description (optional), Region (optional)
- CIDR auto-assigned (shown after creation)

### Server Detail Page (modification)
- Add "Cluster" field showing which cluster the server belongs to (linked)
- Add "WireGuard IP" field when server is in a cluster

---

## 11. File Structure (new files)

```
internal/
├── cluster/
│   ├── service.go               # Cluster CRUD + member management
│   ├── service_test.go
│   ├── cidr.go                  # CIDR allocation algorithm
│   ├── cidr_test.go
│   └── slug.go                  # Slug generation + validation
├── mesh/
│   ├── manager.go               # Mesh regeneration orchestrator
│   ├── manager_test.go
│   ├── config.go                # WireGuard config template generation
│   ├── config_test.go
│   ├── health.go                # Health check processor + status transitions
│   ├── health_test.go
│   └── repair.go                # Auto-repair logic
├── dns/
│   ├── manager.go               # DNS record management + CoreDNS deployment
│   ├── manager_test.go
│   ├── hosts.go                 # Hosts file generation
│   ├── corefile.go              # Corefile template generation
│   └── scripts/
│       └── coredns.sh           # CoreDNS container deployment script
├── api/handler/
│   ├── cluster.go               # Cluster CRUD handlers
│   ├── cluster_member.go        # Member add/remove/list handlers
│   └── mesh.go                  # Health, key rotation, events handlers

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
│   ├── clusters.$teamId.tsx              # Cluster list
│   └── clusters_.$teamId.$clusterId.tsx  # Cluster detail (tabs)
├── components/
│   └── mesh-health-matrix.tsx            # N x N health grid component

proto/agent/v1/
└── agent.proto                           # Extended with WireGuard + DNS messages
```

### Modified Files

```
internal/config/config.go                 # Add WireGuard config (pool CIDR, default port)
internal/api/router.go                    # Register cluster/mesh/dns routes
internal/agent/server.go                  # Handle new WireGuard + DNS message types
internal/agent/connmanager.go             # Add mesh health data tracking
apps/api/main.go                          # Wire cluster, mesh, DNS services
apps/agent/main.go                        # WireGuard management, mesh health checks, DNS handling
sql/migrations/00002_server_management.sql # (no change — new migration adds cluster_id to servers)
```

---

## 12. Testing Strategy

### Unit Tests
- CIDR allocation: allocate multiple clusters, verify no overlap, verify release + reuse
- CIDR allocation: allocate server IPs within cluster, verify sequential, verify max capacity
- Slug generation: various names → valid slugs, collision handling
- WireGuard config generation: 1 node, 2 nodes, 5 nodes — verify correct peer blocks
- Hosts file generation: verify format matches CoreDNS expectations
- Mesh health status transitions: active → degraded → failed → active
- Cluster status derivation from peer link statuses

### Integration Tests (testcontainers)
- Cluster CRUD: create → list → get → update → delete
- Cluster lifecycle: create cluster → add 3 servers → verify members → remove 1 → verify mesh event
- CIDR allocation: create 3 clusters → verify unique CIDRs → delete middle → create new → verify reuse
- Member constraint: attempt to add server already in another cluster → expect error
- Delete constraint: attempt to delete cluster with members → expect error
- Mesh health processing: simulate MeshHealthReport → verify DB updates + status transitions
- DNS records: add/remove members → verify DNS records match expected hostnames and IPs
- Key rotation: trigger rotation → verify new public key stored → verify mesh event logged
- Mesh events: perform various operations → verify event log is accurate

### Exit Criteria (from spec)
1. Cluster created, 3 servers attached, mesh comes up within 60 seconds
2. Every server can ping every other server via WireGuard IP
3. DNS resolves: from `server-a`, `dig server-b.mycluster.internal` returns correct WireGuard IP
4. Adding a 4th server: all existing nodes get updated peer config within 60 seconds
5. Removing a server: peer revoked everywhere within 60 seconds
6. Rebooting a node: mesh restores automatically on boot
7. Simulated link failure surfaces as broken link in UI with affected peer identified
8. Key rotation regenerates keys and updates mesh without downtime

---

## Tech Stack (Phase 2 additions)

| Component | Technology |
|-----------|-----------|
| VPN mesh | WireGuard (kernel module + wg-quick userspace tools) |
| WireGuard management | `wg`, `wg-quick`, `wg syncconf` via agent exec |
| Private DNS | CoreDNS (Docker container on each node) |
| DNS zone | hosts plugin (file-based, auto-reload) |
| CIDR math | Go `net` stdlib (`net.IPNet`, `net.IP`) |
| Config templates | Go `text/template` for WireGuard configs |
| Health checks | ICMP ping via agent + `wg show` dump parsing |
| Mesh health UI | Custom React component (N x N grid) |
