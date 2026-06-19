# Cluster Path B Implementation Plan (Phase 1 of Cloudflare-Edge Architecture)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every node's Traefik route to all healthy replicas across the cluster (not just local containers), so the cluster can sit behind any external edge (Cloudflare, manual LB, DNS round-robin) without per-node routing blind spots.

**Architecture:** Replace per-server Traefik backend grouping with a flat backend list pushed to every node. Containers expose their app port on the host's WireGuard IP via Docker port publishing; the host port is recorded on `deployment_targets` and consumed by `SyncTrafficRoute`. Optional: register replica DNS records via the existing `ExtraRecordProvider` interface so backends can be referenced by name. No new edge tier; no new server role.

**Tech Stack:** Go (control plane + agent), PostgreSQL (sqlc-generated queries), goose migrations, Docker, WireGuard, CoreDNS, Traefik file provider.

**Out of scope (future phases):**
- Phase 2: Cloudflare Tunnels / `cloudflared` provisioning
- Phase 3: Cloudflare DNS automation + Origin Certs
- Phase 4: Cloudflare for SaaS custom domains
- Phase 5: nip.io decommission + migration

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `sql/migrations/00013_replica_host_port.sql` | Create | Add `host_port` to `deployment_targets`, optional `private_dns_name` |
| `sql/queries/deployments.sql` | Modify | Update `UpdateDeploymentTargetStatus` and add `SetDeploymentTargetHostPort`; surface `host_port` on `ListDeploymentTargets` |
| `internal/db/*.sql.go`, `models.go` | Regenerate | sqlc regen after query/migration changes |
| `internal/agent/proto/agent/v1/agent.proto` | Modify | Add `host_port` to `DeployOutput`; add `wg_ip` to `DeployCommand` |
| `apps/agent/deploy.go` | Modify | Allocate ephemeral port, run container with `-p {wg_ip}:{host_port}:{port}`, report port back |
| `apps/agent/port_allocator.go` | Create | Track allocated host ports per agent (in-memory, persisted to disk) |
| `internal/deploy/service.go:737-795` | Modify | Flatten backend grouping; build URLs from `wg_ip:host_port`; send identical command to every server |
| `internal/deploy/service.go:947-970` | Modify | Pass server's WG IP into `DeployCommand`; record returned `host_port` on the target |
| `internal/agent/server.go` (DeployOutput handler) | Modify | Persist `host_port` from output to `deployment_targets` |
| `internal/deploy/replica_dns.go` | Create (optional) | `ExtraRecordProvider` for replica DNS records (`<deploy-id-short>-<idx>.<app>.<project>.cluster.internal`) |
| `cmd/server/main.go` (or wherever wires services) | Modify | Register replica DNS provider with mesh manager |
| `internal/deploy/service_test.go` | Create | Unit tests for flat backend list builder |
| `apps/agent/port_allocator_test.go` | Create | Unit tests for port allocation/release |
| `tests/integration/traffic_routing_test.go` | Modify or extend | Integration test that scaling produces identical config on every server |

---

## Decision Points (decide before starting)

1. **Port range for replicas.** Default: `30000-32767` (Kubernetes-style NodePort range, avoids conflict with system + Docker daemon ranges). Confirm or override.
2. **Container reachability transport.** Default: bind-publish on WG IP only (`-p 10.x.x.x:HP:CP`); container is NOT exposed on public IP. Confirm.
3. **Feature flag.** Default: env var `NIXWAY_PATH_B=true` on the control plane. When false, fall back to existing per-server grouping. Confirm.
4. **Replica DNS records.** Optional in Phase 1 — Traefik can use raw `http://10.x.x.x:HP` URLs and skip CoreDNS extension. Decide: ship without DNS first (smaller change), or include DNS records in Phase 1.

These four answers shape Tasks 1, 3, 7, and 9 below. **Plan assumes defaults** — change before execution if you prefer otherwise.

---

## Task 1: Schema migration for replica host port

**Files:**
- Create: `sql/migrations/00013_replica_host_port.sql`

- [ ] **Step 1: Write the migration**

```sql
-- +goose Up
ALTER TABLE deployment_targets
    ADD COLUMN host_port INT,
    ADD COLUMN host_ip TEXT;

CREATE INDEX idx_deployment_targets_host_lookup
    ON deployment_targets(server_id, host_port)
    WHERE host_port IS NOT NULL;

-- +goose Down
DROP INDEX IF EXISTS idx_deployment_targets_host_lookup;
ALTER TABLE deployment_targets
    DROP COLUMN IF EXISTS host_ip,
    DROP COLUMN IF EXISTS host_port;
```

- [ ] **Step 2: Run migration locally and verify**

Run: `goose -dir sql/migrations postgres "$DATABASE_URL" up`
Expected: `OK 00013_replica_host_port.sql`. Confirm `\d deployment_targets` shows new columns.

- [ ] **Step 3: Commit**

```bash
git add sql/migrations/00013_replica_host_port.sql
git commit -m "feat(deploy): add host_port/host_ip to deployment_targets for cross-node routing"
```

---

## Task 2: SQL queries for host port

**Files:**
- Modify: `sql/queries/deployments.sql`
- Regenerate: `internal/db/deployments.sql.go`, `internal/db/models.go`

- [ ] **Step 1: Add `SetDeploymentTargetHostPort` query**

Append to `sql/queries/deployments.sql`:

```sql
-- name: SetDeploymentTargetHostPort :exec
UPDATE deployment_targets
SET host_port = $2, host_ip = $3, updated_at = now()
WHERE id = $1;
```

- [ ] **Step 2: Verify `ListDeploymentTargets` SELECT includes new columns**

If the existing query is `SELECT *`, no change. If columns are explicit, add `host_port, host_ip`.

- [ ] **Step 3: Regenerate sqlc**

Run: `sqlc generate`
Expected: `internal/db/deployments.sql.go` and `models.go` regenerated. `git diff` shows new method `SetDeploymentTargetHostPort` and new fields on the row struct.

- [ ] **Step 4: Build to confirm no breakage**

Run: `go build ./...`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add sql/queries/deployments.sql internal/db/
git commit -m "feat(db): query+model for deployment_targets.host_port"
```

---

## Task 3: Agent port allocator

**Files:**
- Create: `apps/agent/port_allocator.go`
- Create: `apps/agent/port_allocator_test.go`

- [ ] **Step 1: Write the failing test**

```go
package main

import "testing"

func TestPortAllocator_AllocateReleases(t *testing.T) {
    pa := newPortAllocator(30000, 30002)
    p1, err := pa.Allocate()
    if err != nil || p1 < 30000 || p1 > 30002 {
        t.Fatalf("allocate1: got %d err=%v", p1, err)
    }
    p2, _ := pa.Allocate()
    p3, _ := pa.Allocate()
    if _, err := pa.Allocate(); err == nil {
        t.Fatal("expected exhaustion error")
    }
    pa.Release(p2)
    p4, err := pa.Allocate()
    if err != nil || p4 != p2 {
        t.Fatalf("expected released port reused, got %d", p4)
    }
    _ = p3
}
```

- [ ] **Step 2: Run, expect FAIL**

Run: `go test ./apps/agent -run TestPortAllocator -v`
Expected: build fails (`newPortAllocator` undefined).

- [ ] **Step 3: Implement allocator**

```go
package main

import (
    "fmt"
    "sync"
)

type portAllocator struct {
    mu     sync.Mutex
    min    int
    max    int
    used   map[int]bool
}

func newPortAllocator(min, max int) *portAllocator {
    return &portAllocator{min: min, max: max, used: map[int]bool{}}
}

func (p *portAllocator) Allocate() (int, error) {
    p.mu.Lock()
    defer p.mu.Unlock()
    for port := p.min; port <= p.max; port++ {
        if !p.used[port] {
            p.used[port] = true
            return port, nil
        }
    }
    return 0, fmt.Errorf("no free ports in range %d-%d", p.min, p.max)
}

func (p *portAllocator) Release(port int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    delete(p.used, port)
}

func (p *portAllocator) MarkUsed(port int) {
    p.mu.Lock()
    defer p.mu.Unlock()
    if port >= p.min && port <= p.max {
        p.used[port] = true
    }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `go test ./apps/agent -run TestPortAllocator -v`
Expected: PASS.

- [ ] **Step 5: Add startup reconciliation test**

```go
func TestPortAllocator_MarkUsed(t *testing.T) {
    pa := newPortAllocator(30000, 30001)
    pa.MarkUsed(30000)
    p, err := pa.Allocate()
    if err != nil || p != 30001 {
        t.Fatalf("expected 30001, got %d err=%v", p, err)
    }
}
```

Run: `go test ./apps/agent -run TestPortAllocator -v`
Expected: both tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent/port_allocator.go apps/agent/port_allocator_test.go
git commit -m "feat(agent): add port allocator for replica host ports"
```

---

## Task 4: Agent reconciles allocator from running containers at startup

**Files:**
- Modify: `apps/agent/main.go` (or wherever the agent boots)

- [ ] **Step 1: On agent startup, run `docker ps --format '{{.Ports}}' --filter label=nixway.managed=true` and parse `0.0.0.0:HOSTPORT->...` lines, calling `pa.MarkUsed(HOSTPORT)` for each.** This prevents reallocation of ports already in use after agent restart.

- [ ] **Step 2: Add a unit test using a fake `dockerPS` function injected into the reconcile path.**

- [ ] **Step 3: Build + run agent locally, confirm it logs reconciled ports.**

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(agent): reconcile port allocator from running containers"
```

> ⚠️ Step content here is intentionally less prescriptive — the right structure depends on how `main.go` currently wires startup. Executor: read the file first, then write the test against the concrete extension point.

---

## Task 5: Add `wg_ip` to `DeployCommand` proto

**Files:**
- Modify: `internal/agent/proto/agent/v1/agent.proto`
- Regenerate: corresponding `.pb.go` files

- [ ] **Step 1: Add field**

In `DeployCommand` message:

```proto
string wg_ip = 30;  // server's WireGuard IP, used for port-bind publish
```

In `DeployOutput` message:

```proto
int32 host_port = 11;  // host port that maps to container's app port
string host_ip = 12;   // host IP container is bound on (= wg_ip)
```

- [ ] **Step 2: Regenerate**

Run: `buf generate` (or whatever the repo uses; check `Makefile` / `buf.yaml`)
Expected: regenerated `.pb.go` files compile.

- [ ] **Step 3: Build**

Run: `go build ./...`
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add internal/agent/proto/ internal/db/
git commit -m "feat(proto): add wg_ip to DeployCommand, host_port/host_ip to DeployOutput"
```

---

## Task 6: Agent allocates port and publishes container on WG IP

**Files:**
- Modify: `apps/agent/deploy.go:44-50`

- [ ] **Step 1: At top of `HandleDeployCommand`, allocate a host port**

```go
hostPort, err := portAlloc.Allocate()
if err != nil {
    sendOutput("failed", "", true, false, fmt.Sprintf("port alloc: %v", err))
    return
}
defer func() {
    // If we never reach the success-path output, release.
    // (Success path zeroes this var to skip release.)
    if hostPort != 0 {
        portAlloc.Release(hostPort)
    }
}()
```

- [ ] **Step 2: Add `-p` flag to docker run args**

```go
if cmd.WgIp != "" {
    args = append(args, "-p", fmt.Sprintf("%s:%d:%d", cmd.WgIp, hostPort, cmd.Port))
} else {
    // Path A fallback: legacy local-only routing
    // (no -p needed; Traefik reaches container via Docker network name)
}
```

- [ ] **Step 3: When deploy succeeds (after health check), include `host_port`/`host_ip` in `sendOutput`**

Modify the success-path `sendOutput` call to populate the new proto fields. Set the `defer`'s `hostPort` var to 0 so the release doesn't fire.

- [ ] **Step 4: On failure (any phase), the deferred release fires.** Confirm flow.

- [ ] **Step 5: Manual test: deploy one app, `docker ps` shows `10.x.x.x:30000->8080/tcp`. From another node, `curl http://10.x.x.x:30000/`. Expect 200.**

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(agent): publish replica container on WG IP with allocated host port"
```

---

## Task 7: Control plane records host port on DeployOutput

**Files:**
- Modify: `internal/agent/server.go` (the `HandleDeployOutput` path)

- [ ] **Step 1: When a `DeployOutput` arrives with `host_port > 0`, call `queries.SetDeploymentTargetHostPort(ctx, target.ID, host_port, host_ip)` before the existing healthy-status update.**

- [ ] **Step 2: Add an integration test** in `tests/integration/agent_test.go` that simulates a `DeployOutput` with `host_port=30000`, then queries the target row and asserts the column.

- [ ] **Step 3: Build + test**

Run: `go test ./tests/integration/ -run TestDeployOutput -v`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(deploy): persist replica host_port from agent reports"
```

---

## Task 8: Control plane sends WG IP in DeployCommand

**Files:**
- Modify: `internal/deploy/service.go:947-970` (`dispatchDeploy`)

- [ ] **Step 1: Look up the target server's WG IP via cluster member query (already exists for mesh — find it in `internal/cluster/` or `internal/mesh/`). Pass into `DeployCommand.WgIp`.**

- [ ] **Step 2: If the server has no WG IP (single-node, pre-cluster setup), leave the field empty — agent falls back to legacy mode.**

- [ ] **Step 3: Build + commit**

```bash
git commit -am "feat(deploy): pass server WG IP into DeployCommand"
```

---

## Task 9: Flat backend list in `SyncTrafficRoute`

**Files:**
- Modify: `internal/deploy/service.go:716-796`

- [ ] **Step 1: Write a unit test for the new builder function**

Extract the URL-building logic into a pure function `buildTrafficGroups(backends []TrafficBackendRow, targetsByDeploy map[uuid.UUID][]TargetRow, app App) []*agentv1.TrafficBackendGroup` so it's testable without a DB.

```go
func TestBuildTrafficGroups_PathB(t *testing.T) {
    app := App{Slug: "demo", Port: 8080}
    backends := []TrafficBackendRow{{ID: uuid.New(), DeploymentID: dep1, Label: "stable", Weight: 100}}
    targets := map[uuid.UUID][]TargetRow{
        dep1: {
            {ServerID: srvA, HostIP: "10.100.0.1", HostPort: 30000, Status: "healthy"},
            {ServerID: srvB, HostIP: "10.100.0.2", HostPort: 30001, Status: "healthy"},
        },
    }
    groups := buildTrafficGroups(backends, targets, app)
    require.Len(t, groups, 1)
    require.ElementsMatch(t, groups[0].Urls, []string{
        "http://10.100.0.1:30000",
        "http://10.100.0.2:30001",
    })
}
```

- [ ] **Step 2: Run test, expect FAIL** (function not yet defined)

- [ ] **Step 3: Refactor `SyncTrafficRoute`**

Replace lines 737-795 with:

```go
type group struct {
    name   string
    weight int32
    urls   []string
}
groupsByDeployment := map[uuid.UUID]*group{}
allServers := map[uuid.UUID]string{}

for _, backend := range backends {
    targets, err := s.queries.ListDeploymentTargets(ctx, backend.DeploymentID)
    if err != nil {
        continue
    }
    g := &group{
        name:   trafficServiceName(app.Slug, backend.Label, backend.DeploymentID),
        weight: backend.Weight,
    }
    for _, target := range targets {
        if target.Status != "healthy" || target.HostPort == nil {
            continue
        }
        g.urls = append(g.urls, fmt.Sprintf("http://%s:%d", *target.HostIP, *target.HostPort))
        server, err := s.queries.GetServerByID(ctx, db.GetServerByIDParams{ID: target.ServerID, TeamID: project.TeamID})
        if err == nil && server.AgentID != nil {
            allServers[target.ServerID] = *server.AgentID
        }
    }
    if len(g.urls) > 0 {
        groupsByDeployment[backend.DeploymentID] = g
    }
}

// One identical command, sent to every server in the cluster.
cmdGroups := make([]*agentv1.TrafficBackendGroup, 0, len(groupsByDeployment))
for _, g := range groupsByDeployment {
    cmdGroups = append(cmdGroups, &agentv1.TrafficBackendGroup{
        Name: g.name, Weight: g.weight, Urls: g.urls,
    })
}

domains := trafficDomains(app, route)
for serverID, agentID := range allServers {
    if err := s.connMgr.SendToAgent(agentID, &agentv1.ControlMessage{ /* same as before */ }); err != nil {
        s.logger.Warn("traffic route sync failed", "server", serverID, "error", err)
    }
}
```

> ⚠️ Note: this sends the command only to servers that *currently host a replica*. To enable Path B fully (any node can route to any app), you must also send to **every cluster member**, not just hosting ones. Add a `s.queries.ListClusterMembersForApp(...)` lookup keyed off the app's environment/cluster. Confirm the right query exists or add one.

- [ ] **Step 4: Run test, expect PASS**

- [ ] **Step 5: Run integration test**

Verify `tests/integration/cluster_test.go` and any traffic-routing integration tests still pass.

- [ ] **Step 6: Commit**

```bash
git commit -am "feat(deploy): flat backend list — every node routes to every healthy replica"
```

---

## Task 10: Feature flag

**Files:**
- Modify: `internal/deploy/service.go` (entry of `SyncTrafficRoute` and `dispatchDeploy`)

- [ ] **Step 1: Read env `NIXWAY_PATH_B` once at service construction; store on `s.pathB bool`.**

- [ ] **Step 2: In `SyncTrafficRoute`, branch: `if s.pathB { /* new flat path */ } else { /* old grouped path */ }`.**

- [ ] **Step 3: In `dispatchDeploy`, only set `WgIp` when `s.pathB`.**

- [ ] **Step 4: Document in `docs/local-lab.md` how to flip the flag.**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(deploy): NIXWAY_PATH_B feature flag for cross-node routing"
```

---

## Task 11: End-to-end manual verification

- [ ] **Step 1: On a 2-node staging cluster, set `NIXWAY_PATH_B=true`, restart control plane.**

- [ ] **Step 2: Deploy an app with `replicas=2`. Confirm one replica lands on each node.**

- [ ] **Step 3: `docker ps` on each node — confirm `10.x.x.x:PORT->APPPORT/tcp` published.**

- [ ] **Step 4: `cat /etc/traefik/dynamic/<app-slug>.yml` on **both** nodes — content must be identical and contain both replica URLs.**

- [ ] **Step 5: `curl --resolve <domain>:80:<node-A-ip> http://<domain>/` repeatedly. Confirm responses come from both replicas (e.g. via a hostname-echoing test app).**

- [ ] **Step 6: Repeat with `node-B-ip` in `--resolve`. Same result expected.**

- [ ] **Step 7: Kill replica on node A. Within health-check interval, Traefik on both nodes should drop it.**

- [ ] **Step 8: Document observed behavior in a short report. If anything diverges, file a bug task.**

---

## Task 12 (optional): Replica DNS records via ExtraRecordProvider

Skip this for an MVP shipping. Include only if you want backends addressable by name (`replica-abc12-0.<app>.<project>.cluster.internal`) for debugging or future Cloudflare Tunnels Origin DNS use.

**Files:**
- Create: `internal/deploy/replica_dns.go`
- Modify: wherever `mesh.Manager` is instantiated to call `RegisterExtraProvider`

- [ ] **Step 1: Implement `HostsForCluster(ctx, clusterID)` returning a slice of `dns.Record` for every healthy target in the cluster.**

- [ ] **Step 2: Trigger DNS refresh on deployment health changes.** Wire into existing healthy-target callback.

- [ ] **Step 3: Test resolution from inside a container on node A: `dig replica-X.app.proj.cluster.internal +short` → should return the WG IP of the hosting node.**

- [ ] **Step 4: Commit**

---

## Self-Review

**Spec coverage:**
- Cross-node routing ✅ (Tasks 6, 8, 9)
- Health-aware backend list ✅ (Task 9, filter `target.Status == "healthy"`)
- Feature-flag rollout ✅ (Task 10)
- Verification ✅ (Task 11)
- DNS layer ✅ (Task 12, optional)

**Placeholder scan:** Tasks 4, 7, 8, 12 leave concrete extension points to the executor instead of pasting full code. This is deliberate — the right shape depends on existing wiring (e.g. how `main.go` builds services, exact name of cluster-member query). Plan calls these out with ⚠️ and gives the test contract; not a placeholder failure, but worth flagging.

**Type consistency:**
- `host_port` is `int32` in proto, `INT` in SQL (PG `int` = int32 ✓), `*int32` in Go after sqlc nullable mapping.
- `host_ip`/`wg_ip` consistently strings.
- `TargetRow.HostIP`/`HostPort` field names assume sqlc default — confirm exact names after Task 2 regen.

---

## Execution Choice

After approving this plan, two execution paths:

1. **Subagent-Driven** — fresh subagent per task, two-stage review between tasks. Best for catching drift on a multi-day refactor.
2. **Inline** — execute in this session with checkpoints after Tasks 4, 8, 11.

Decide which approach, and answer the four Decision Points at the top, before starting Task 1.
