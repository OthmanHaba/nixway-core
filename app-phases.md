# PaaS Platform — Detailed Phased Spec

Each phase has **Deliverables** (what gets built), **Technical Specifics** (implementation detail), and **Done When** (exit criteria).

---

## Phase 0: Foundation

**Deliverables**
- Control plane API service
- PostgreSQL for platform state
- Redis for queues, pub/sub, sessions
- Job queue + worker system
- Agent binary with mTLS
- CLI tool skeleton
- Web UI skeleton
- Auth: signup, login, password reset, sessions
- Teams, team invites, membership
- API tokens with scopes
- Base RBAC (owner, admin, member)
- Audit log subsystem

**Technical Specifics**
- API framework choice (REST with OpenAPI spec, or gRPC with generated clients)
- PostgreSQL schema versioned via migrations (Flyway, sqlx, Prisma Migrate, etc.)
- Redis used for: job queue, realtime pub/sub, session cache, rate limit counters
- Job system supports: retries with exponential backoff, dead letter queue, job priorities, scheduled jobs, distributed locks
- Agent: Go or Rust, single static binary, arm64 + amd64 Linux, <20MB
- Agent↔control plane: persistent gRPC stream or WebSocket with reconnect logic
- mTLS: control plane is CA, issues per-agent certs, cert rotation mechanism
- Agent protocol messages: heartbeat, exec command, stream stdout/stderr, file transfer, health report
- CLI authenticates via API token stored in OS keychain when available
- Audit log: append-only table, indexed by actor, resource, action, timestamp

**Done When**
- User signs up, verifies email, logs in, creates team, invites user, user accepts
- Job enqueued from API is picked up by worker, runs, reports completion
- Agent installs on a Linux VM, registers with control plane, heartbeat flows every N seconds
- Control plane sends `exec` command to agent; stdout streams back in real time
- Killing and restarting agent reconnects within 10 seconds without manual intervention
- CLI can log in and list teams
- Revoking an API token invalidates it immediately
- Audit log records all of the above with correct actor attribution
- Integration test suite covers: auth flows, job processing, agent connect/disconnect, audit log writes

---

## Phase 1: Server Management

**Deliverables**
- SSH key CRUD + rotation
- Multi-key attachment per server
- Server onboarding flow
- Agent installer over SSH
- Heartbeat + status (online, offline, degraded, provisioning)
- Resource inventory per server
- Server tagging/labeling
- Provisioning engine with selectable components
- Repo auto-discovery engine
- Server detail view with logs

**Technical Specifics**
- SSH keys: ed25519 preferred, RSA 2048+ accepted, stored encrypted (libsodium secretbox or equivalent) with per-team KMS key
- Server add flow captures: hostname, public IP, SSH port, SSH user, auth method (key reference or password — password discouraged, flagged in UI)
- Initial connectivity check: SSH handshake, `uname -a`, disk space check, sudo capability check
- OS detection via `/etc/os-release`; v1 supports Ubuntu 22.04/24.04 and Debian 12
- Agent installer script: downloads signed agent binary, verifies checksum, installs as systemd service, registers with control plane using a one-time enrollment token
- Heartbeat interval: 10s default, configurable; status transitions: online → degraded (2 missed) → offline (5 missed)
- Resource inventory collected on heartbeat: CPU model + cores, total + available RAM, disk per mount, network interfaces + IPs, kernel version, Docker version
- Tags: key-value, arbitrary, used later for scheduling constraints
- Provisioning components (each is a separate selectable module):
  - **Docker**: latest stable from official repo, daemon config with log rotation, overlay2 storage driver, live-restore enabled
  - **Traefik**: v3.x, runs as container, exposes 80/443, dynamic config via file provider synced by agent, Docker provider enabled
  - **Nixpacks**: CLI installed to `/usr/local/bin`
  - **Cloud Native Buildpacks** (`pack` CLI): installed to `/usr/local/bin`, default builder configured
  - **Heroku buildpack compatibility**: via `pack` + heroku builder image
  - **Railpack**: CLI installed
- Auto-discovery engine: inspects repo tree, returns ranked builder candidates with reasons
  - Dockerfile present → Docker (highest priority unless user overrides)
  - `nixpacks.toml` present → Nixpacks
  - `Procfile` + language lockfile → Buildpacks/Heroku
  - Language detection fallback: `package.json` → Node via Nixpacks, `requirements.txt`/`pyproject.toml` → Python, `go.mod` → Go, `Cargo.toml` → Rust
- Provisioning runs as a tracked job with step-by-step logs surfaced in UI
- Failed provisioning is retryable without re-adding server

**Done When**
- User adds server, agent installs and reports online within 2 minutes
- User selects components (e.g. Docker + Traefik + Nixpacks), provisioning completes with logs visible in UI
- Resource metrics update on heartbeat
- Auto-discovery correctly identifies builder for 5 sample repos (Node, Python, Go, Rust, static HTML + Dockerfile override)
- Server reboot: agent reconnects, state restored
- SSH key rotation: old key removed from server, new key works, verified via agent check
- Removing server: deregisters, offers optional cleanup (removes Docker containers/networks created by platform)
- Tagging a server with `env=prod` is visible in server list and filterable

---

## Phase 2: Clusters + Private Networking

**Deliverables**
- Cluster CRUD
- Server-to-cluster assignment
- WireGuard mesh auto-configuration
- Private CIDR allocation per cluster
- Private DNS for cluster-internal resolution
- Mesh health monitoring + auto-repair
- Cluster detail view

**Technical Specifics**
- Cluster entity: name, description, region label (free-form), private CIDR (auto-assigned from pool, e.g. `10.100.0.0/16` per cluster), member servers
- One server belongs to one cluster at a time (v1 constraint)
- WireGuard keypair generated on agent, public key sent to control plane, private key never leaves node
- CIDR allocator: platform maintains a pool (e.g. `10.100.0.0/10`), each cluster gets a /16, each server in cluster gets a /32 from that /16
- Mesh topology: full mesh (every node peers with every other), simpler than hub-and-spoke, fine up to ~50 nodes per cluster
- Peer config pushed to agents via control plane; agent applies via `wg-quick` or native netlink
- CoreDNS deployed as a container on each node, listens on WireGuard interface IP
- Cluster DNS zone: `<cluster-slug>.internal`
- Auto-registered records:
  - `<server-name>.<cluster-slug>.internal` → WireGuard IP
  - `<service-name>.<cluster-slug>.internal` → service load balancer IP (populated in Phase 4)
- Mesh health check: each agent pings all peers every 30s, reports link status to control plane
- Auto-repair triggers on: node add (regenerate configs for all nodes), node remove (revoke keys, regenerate), key rotation, link failure (retry, escalate to manual if persistent)
- Cluster detail view shows: member list with status, mesh link matrix (N×N health grid), DNS status, CIDR allocation

**Done When**
- Cluster created, 3 servers attached, mesh comes up within 60 seconds
- Every server can ping every other server via WireGuard IP
- DNS resolves: from `server-a`, `dig server-b.mycluster.internal` returns correct WireGuard IP
- Adding a 4th server: all existing nodes get updated peer config within 60 seconds, new node joins mesh
- Removing a server: peer revoked everywhere within 60 seconds
- Rebooting a node: mesh restores automatically on boot
- Simulated link failure (blocking a port) surfaces as broken link in UI with affected peer identified
- Key rotation command regenerates keys and updates mesh without downtime

---

## Phase 3: Integrations

**Deliverables**
- GitHub App creation + installation flow
- Webhook receiver
- Token refresh + permission scopes
- Per-project repo binding model
- Container registry credentials (Docker Hub, GHCR, ECR, generic)
- Encrypted secrets store with per-environment scoping

**Technical Specifics**
- GitHub App flow: user hits "Create GitHub App" → platform generates manifest → redirects to GitHub's app creation URL with pre-filled manifest → GitHub redirects back with code → platform exchanges code for app credentials → stores encrypted
- Manifest permissions: repository contents (read), metadata (read), pull requests (read), webhooks (write)
- Installation flow: user installs the app on their org/account, selects repos, platform receives installation webhook, stores installation ID
- Webhook endpoint: verifies `X-Hub-Signature-256` with HMAC-SHA256, rejects invalid
- Supported events in v1: `push`, `pull_request` (opened/synchronize/closed), `create` (tag)
- Installation tokens: fetched on-demand via JWT signed with app private key, cached with TTL, auto-refreshed
- Repo listing: platform queries installation's accessible repos, caches with short TTL
- Registry credentials: stored encrypted, supports:
  - Docker Hub (username + token)
  - GHCR (username + PAT)
  - ECR (AWS access key + secret, region; auto-generates auth token)
  - Generic (registry URL + username + password/token)
- Credential validation: platform attempts an authenticated `HEAD` or `/v2/` ping on save, reports success/failure
- Secrets store:
  - Encrypted at rest with per-team KMS key envelope (DEK per secret, KEK per team)
  - Scoped to project + environment (`production`, `staging`, `preview`, or custom)
  - Reveal-once pattern: after creation, value masked in UI, can be rotated not re-read
  - Reference syntax in env vars: `${SECRET_NAME}` resolved at deploy time
  - Secret categories: plain string, file (mounted as file at runtime), reference to other secrets
  - Audit: every read surfaces in audit log with requesting job/user

**Done When**
- User creates GitHub App, installs on their org, selects 3 repos, sees them listed
- Push to a selected repo triggers a webhook, signature verified, event stored
- Invalid signature rejected with 401
- Installation token refreshes correctly after expiration
- User adds Docker Hub credential, platform pulls a private test image successfully
- ECR credential generates valid auth token
- Secret created, value encrypted in DB (verified by raw DB inspection showing ciphertext)
- Secret referenced in deploy config resolves to correct plaintext at container start
- Secret audit log entries appear for every resolve

---

## Phase 4: Projects + Deployments

**Deliverables**
- Project CRUD bound to a cluster
- App/service entity within project
- Deploy source selection: GitHub repo or Docker image
- Build orchestrator
- Deploy orchestrator
- Platform-managed wildcard domain
- Custom domain attachment with TLS
- Deploy history + rollback

**Technical Specifics**
- Project: belongs to one cluster, contains multiple apps/services, has environments (prod + user-defined)
- App/service: source type (git or image), build config, runtime config, domains, replicas, resource limits
- Deploy source types:
  - **GitHub repo**: select from installed GitHub App's accessible repos; pick branch; optionally auto-deploy on push
  - **Docker image**: registry credential reference + image + tag; optional auto-redeploy on tag update (requires registry webhook or polling)
- Build orchestrator:
  - Clone at commit SHA into workspace on a builder (dedicated builder server, or any cluster server with `builder` role)
  - Run auto-discovery → propose builder → user can override
  - Build execution:
    - **Dockerfile**: `docker buildx build` with inline cache
    - **Nixpacks**: `nixpacks build` → OCI image
    - **Buildpacks**: `pack build` with project-configured builder
    - **Railpack**: `railpack build`
  - Build cache: buildkit cache mount, keyed by project+branch, size-capped, LRU eviction
  - Build logs: streamed via Redis pub/sub, UI subscribes via websocket
  - Build output: OCI image, tagged with `project/app:<git-sha>` and `project/app:latest`, pushed to internal registry (v1) with option to push to user registry
- Deploy orchestrator:
  - Target server selection via scheduler (initially: spread across cluster servers)
  - Pull image on target server
  - Generate Traefik labels:
    - `traefik.enable=true`
    - `traefik.http.routers.<app>.rule=Host(...)` (combines platform domain + custom domains)
    - `traefik.http.routers.<app>.tls.certresolver=letsencrypt`
    - `traefik.http.services.<app>.loadbalancer.server.port=<port>`
  - Inject platform env vars:
    - `PLATFORM_PRIVATE_IP` (WireGuard IP of host)
    - `PLATFORM_PRIVATE_DOMAIN` (cluster-internal FQDN)
    - `PLATFORM_PUBLIC_DOMAIN` (assigned public URL)
    - `PORT` (container listen port)
    - `CLUSTER_NAME`, `PROJECT_NAME`, `APP_NAME`, `ENVIRONMENT`, `DEPLOY_ID`, `GIT_SHA`
  - Inject user secrets (resolved from secrets store)
  - Start container with resource limits (CPU + memory) and restart policy
  - Health check: configurable HTTP path, TCP port check, or command; wait up to timeout before marking healthy
  - Rolling deploy: start N new, wait healthy, stop N old, repeat until replaced
  - Rollback: redeploys the previous successful image tag with previous env/config snapshot
- Wildcard domain:
  - Platform owns a base domain (e.g. `apps.platform.tld`)
  - Each app gets `<app>-<project>-<team>.apps.platform.tld`
  - DNS wildcard record points to Traefik load balancer IPs
- Custom domain:
  - User adds domain, platform provides CNAME/A target
  - Platform verifies DNS propagation before issuing cert
  - Traefik routes based on Host header
- TLS:
  - Let's Encrypt via Traefik's cert resolver
  - HTTP-01 for standard domains
  - DNS-01 for wildcards, with pluggable DNS providers (Cloudflare, Route53, DigitalOcean DNS, manual)
- Deploy history: stores image tag, commit SHA, env snapshot, config snapshot, logs pointer, build duration, deployer, timestamp

**Done When**
- User creates project in a cluster, attaches GitHub repo, configures auto-deploy on main
- Push to main triggers build within 10 seconds of webhook arrival
- Build logs stream live in UI
- Successful build triggers deploy; app reachable at platform wildcard URL over HTTPS within 2 minutes total
- Custom domain attached; cert issues via HTTP-01 within 2 minutes after DNS verified
- Wildcard custom domain works via DNS-01 with Cloudflare provider
- Rolling deploy under continuous load test: zero dropped requests (verified with `hey` over 60s)
- Rollback: one click restores previous version within 30 seconds, recorded as new deploy
- Docker image source: specify `nginx:1.25`, deploys and routes correctly
- Deploy history view shows last 20 deploys with all metadata and clickable logs
- Platform env vars and secrets both resolve correctly inside container (verified via `env` exec)

---

## Phase 5: Runtime Operations

**Deliverables**
- Realtime log streaming per container
- Historical log storage + search
- Multi-replica log tail
- Server-level syslog access
- Web terminal into containers (per-app, per-replica selection)
- Container lifecycle controls
- Container inspect view
- Runtime resource limit editing
- Deploy history with rollback (extended from Phase 4)

**Technical Specifics**
- Log streaming:
  - Agent tails container logs via Docker API (`/containers/<id>/logs?follow=true`)
  - Streams to control plane over existing gRPC/WebSocket channel
  - Control plane fans out via Redis pub/sub to UI websockets
  - Latency target: <2 seconds end to end
- Historical logs:
  - Shipped to Loki or ClickHouse (pick one — ClickHouse scales better, Loki is simpler)
  - Indexed by: team, project, app, replica ID, timestamp, level (if parseable)
  - Retention: configurable per team (default 7 days, paid tiers longer)
- Log search UI:
  - Filters: app, replica, time range, text match (substring + regex)
  - Live tail mode vs historical mode
- Multi-replica tail: subscribes to all replicas, interleaves with replica labels color-coded
- Server syslog: agent exposes journald snippets via control plane on demand (not continuous)
- Web terminal:
  - UI opens websocket → control plane → agent → Docker `exec` with `tty=true, stdin=true`
  - Shell: `/bin/sh` fallback from `/bin/bash`
  - PTY resize propagated
  - Session timeout + idle kill (configurable, default 30 min idle)
  - Audit log records: who opened terminal, which container, duration
  - **Per-replica selection**: if app has multiple replicas, user picks which one to exec into from a dropdown showing replica ID, server, and status
- Container controls: start, stop, restart, redeploy (pulls latest image + redeploys same config)
- Container inspect: image digest, all env vars (secrets masked), labels, resource limits, uptime, restart count, last exit code, mounts
- Runtime resource limit edit: changes limits on container config, requires restart of replicas (rolling)

**Done When**
- Log line emitted by container appears in UI within 2 seconds
- Historical search over last 7 days returns results under 1 second for common queries
- Multi-replica tail across 5 replicas interleaves correctly with visible labels
- Web terminal: user picks replica 2 of 5, opens working shell, runs commands, survives 10 min idle, closes cleanly
- Audit log shows terminal session with correct replica and user
- Restart container from UI: replica stops, restarts, rejoins load balancer pool
- Changing memory limit from 512MB to 1GB triggers rolling restart, new limit visible in inspect
- Inspect view masks secret values (shows `SECRET_REF:<name>` instead of plaintext)

---

## Phase 6: Scaling + Load Balancing

**Deliverables**
- Manual replica count
- Placement strategies
- Scheduler
- Autoscaling rules + evaluator
- Load balancer sync with health-aware routing
- Weighted routing (primitive for canary in Phase 9)
- Scaling events log

**Technical Specifics**
- Replica count: integer per app per environment
- Placement strategies:
  - **Spread**: maximize distribution across servers (default)
  - **Binpack**: fill servers up to a threshold before moving to next
  - **Pinned**: user specifies server(s); replicas only schedule there
  - Constraints via tags: `must-have: env=prod`, `must-not-have: role=db`
- Scheduler:
  - Input: app requirements (CPU request, memory request, strategy, constraints), current cluster state
  - Output: list of (server, replica count) assignments
  - Refuses with clear error if insufficient capacity (returns which constraint failed)
- Autoscaling rules:
  - Metric source: Prometheus query (CPU %, RAM %, Traefik request rate, custom)
  - Condition: `metric > threshold for duration`
  - Action: scale up by N or to target, scale down by N or to target
  - Bounds: min + max replicas (hard caps)
  - Cooldown: separate for up + down (default up=60s, down=300s)
- Autoscaler worker: evaluates all rules every 30s, triggers scale jobs, respects cooldowns
- Load balancer sync:
  - On replica start: wait for health check pass, add to Traefik backend pool
  - On replica stop: mark draining, remove from pool, wait for connections to finish (configurable grace, default 30s), then SIGTERM → SIGKILL if needed
  - Traefik config regenerated atomically; no in-flight requests dropped
- Weighted routing: per backend weight (0-100), Traefik's weighted round robin
- Scaling events: stored with metric value, rule triggered, resulting replica count, timestamp; visible in UI timeline

**Done When**
- Setting replicas=5 schedules across 5 servers (spread) or fills servers to threshold (binpack)
- Pinned placement with tag `gpu=true` only schedules on tagged servers
- Autoscale rule `cpu > 80% for 2 min → +1 replica (max 10)` triggers scale-up under synthetic load
- Scale-down `cpu < 20% for 5 min → -1 replica (min 2)` drains replicas without dropping requests
- Scheduler refuses scale-up when cluster at capacity with error naming the missing resource
- Load balancer never routes to unhealthy replica (verified with 10k-request load test during scale events)
- Weighted routing at 50/50 between two backends splits traffic ~50/50 (statistical check)
- Scaling events appear in UI with metric values and rule names

---

## Phase 7: Observability

**Deliverables**
- Metrics collection via agent
- Metrics backend
- Four dashboard levels: server, container, project, cluster
- Realtime + historical views
- Retention config
- Alert rules CRUD
- Alert notifications + state tracking

**Technical Specifics**
- Agent exports metrics in Prometheus format on WireGuard IP:
  - Server: CPU (per core + total), RAM (used/free/cached), disk (per mount), network I/O (per interface), load average, file descriptor count
  - Container (via cAdvisor or direct cgroup reads): CPU, RAM, network I/O, disk I/O, restart count, uptime
- Metrics backend: VictoriaMetrics (cheaper storage) or Prometheus (simpler); pick one
- Scrape config auto-generated per cluster as servers are added
- Dashboard stack: Grafana embedded, or custom React dashboards querying PromQL directly (custom gives better UX, Grafana is faster to ship)
- Realtime view: 15-second refresh, last 5 min window
- Historical view: configurable range (1h, 24h, 7d, 30d)
- Retention: default 30 days raw, 1 year downsampled to 5-min resolution
- Alert rules:
  - Metric (PromQL query or preset)
  - Threshold + comparison + duration
  - Severity (info, warning, critical)
  - Notification channels: email, webhook, Slack, Discord (extendable)
  - Silence/snooze ability
- Alert evaluator: runs every 30s, transitions state (pending → firing → resolved), sends notifications on state change only
- Notification templates: customizable, includes metric value, threshold, link to dashboard

**Done When**
- All 4 dashboards load under 2 seconds with realistic data (20 servers, 100 containers)
- Metrics visible within 15 seconds of collection
- 30-day historical query completes without timeout
- Alert `server_cpu > 90% for 5 min` fires correctly, notifies Slack within 1 minute
- Resolved alert sends resolution notification
- Silenced alert does not notify during silence window
- Metrics for deleted resources stop being collected, purged per retention

---

## Phase 8: Databases, Volumes, and Service Templates

**Deliverables**
- Template registry for common services
- **Volume management: create, attach, detach, snapshot, resize, delete**
- **Volume-to-database binding with private DNS discovery from same cluster**
- **Database provisioning flow with version selection**
- **Placement option: same cluster server vs dedicated server**
- **Secret auto-generation + return on provisioning**
- Database tooling: terminal, table browser, query runner, Redis inspector
- Backup + restore
- Connection-string injection into apps

**Technical Specifics**

**Template registry (v1 set)**
- PostgreSQL (versions: 14, 15, 16, 17 — user selects at provision time)
- MySQL (8.0, 8.4)
- MongoDB (6, 7, 8)
- Redis (6, 7)
- RabbitMQ (3.12, 3.13, 4.0)
- MinIO (latest stable)
- Meilisearch (1.x)
- Each template defines: available versions, image per version, required env, default resources, volume spec, port(s), health check, connection string format, default credentials policy (always generated, never defaulted)

**Volume management (lifecycle, explicit)**
- Volume entity: name, size, filesystem, host server, cluster, mount path mapping
- **Create on demand**: user specifies size + name + target cluster; platform picks a server (or user pins)
- **Attach**: bind volume to a container at specified mount path; if container exists, triggers restart with new mount
- **Detach**: stop container using volume, unmount, mark volume unattached
- **Move**: copy volume to different server in cluster (uses cluster WireGuard mesh for transfer), then re-attach
- **Snapshot**: point-in-time copy stored locally or to object storage
- **Resize**: grow volume (shrink not supported in v1); if backing FS supports online resize (ext4, xfs), done live; otherwise requires container restart
- **Delete**: requires confirmation, optionally retain snapshot
- Volume status: unattached, attached, moving, snapshotting, resizing, error
- Volumes are cluster-scoped but physically on one server (v1 — no distributed volumes)

**Volume-to-database binding + private DNS discovery**
- When provisioning a database, platform creates a volume and attaches it at the DB's data path (e.g. `/var/lib/postgresql/data`)
- DB container is registered in cluster DNS: `<db-name>.<project>.<cluster-slug>.internal` → private WireGuard IP of host
- Any container in the same cluster resolves the DB via that FQDN over the WireGuard mesh
- **Cross-cluster access is explicitly denied by default** (DNS not resolvable, network not routable); opt-in peering is a future feature
- An existing volume can be attached to a new database container (e.g. migrating to new version) — platform warns about version compatibility

**Database provisioning flow**
1. User picks template (e.g. PostgreSQL)
2. User picks version from dropdown (e.g. 16.4)
3. User picks placement:
   - **Same cluster server as an existing app** (user picks which server; platform shows available resources)
   - **Dedicated server** (user picks a server in cluster with no other workloads, or provisions a fresh server and adds it to cluster first)
   - **Any available server** (platform scheduler picks based on capacity)
4. User picks resources (CPU, RAM, volume size)
5. User picks backup policy (none, daily, custom cron) and retention
6. User optionally picks name (auto-generated otherwise)
7. Platform:
   - Creates volume, attaches to container
   - Generates credentials (superuser password, app-user password — random, high entropy)
   - Starts container with correct env
   - Waits for health check
   - Registers DNS record in cluster zone
   - Stores credentials in secrets store, scoped to project
   - **Returns secrets to user once in UI** (copy-paste, marked reveal-once) + shows connection string
8. Connection string format: `postgresql://app_user:<password>@<db-name>.<project>.<cluster-slug>.internal:5432/<dbname>`

**Connection string injection**
- User can "link" a DB to an app in the same project
- Linking injects env vars automatically:
  - `DATABASE_URL` (full connection string)
  - `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_USER`, `DATABASE_PASSWORD`, `DATABASE_NAME`
- Prefix configurable (e.g. `POSTGRES_` vs `DATABASE_`) for multi-DB apps
- Linked app auto-redeploys (or on next deploy) with new env

**Database tooling**
- **Terminal to DB container**: same mechanism as Phase 5 container terminal; shell is `psql` / `mysql` / `mongosh` / `redis-cli` depending on template (user can drop to `/bin/sh` if needed)
- **Table browser (SQL)**: list databases → schemas → tables → paginated rows (default 100, configurable up to 1000); sortable columns; readonly by default, edit behind explicit toggle
- **Query runner**: run arbitrary SQL; result grid; query history per user; save named queries per project
- **Redis inspector**: key list with pattern filter, type-aware viewer (string, hash, list, set, zset, stream), TTL display, live `INFO` + `CONFIG GET` panel refreshing every few seconds
- **MongoDB**: collection browser, document viewer, query input (JSON filter)

**Backup + restore**
- Scheduled: cron expression, targets: object storage (S3, R2, MinIO — user's or platform's)
- Backup method: native tools (`pg_dump`, `mysqldump`, `mongodump`, `redis BGSAVE` + copy) wrapped by agent
- Retention: last N or older-than-X-days policy
- Restore: select backup, pick target (in-place = replace current DB, or new DB), confirm, runs restore as a job with logs
- Point-in-time recovery (PITR): v2 feature, flag this in roadmap but skip in Phase 8

**Done When**
- User deploys PostgreSQL 16.4 on a dedicated server in cluster; credentials displayed once and retrievable from secrets store
- Connection string works from an app in the same cluster via private DNS
- App in different cluster cannot resolve or connect (verified)
- User creates a standalone 50GB volume, attaches to a MySQL 8.4 deployment, confirms data persists across container recreation
- User resizes volume from 50GB to 100GB; new size visible in container, no data loss
- User snapshots volume, deletes DB, restores from snapshot, data intact
- User moves volume from server A to server B in same cluster; DB redeploys on B, still reachable via same DNS name
- Web terminal opens a working `psql` for Postgres, `redis-cli` for Redis, `mongosh` for Mongo, on a user-chosen replica
- Table browser lists tables and first 100 rows for Postgres and MySQL
- Query runner executes `SELECT` and returns results grid
- Redis inspector shows live keys, TTLs, and `CONFIG GET` refreshing
- Linking DB to app auto-injects env vars; app connects on next deploy
- Scheduled daily backup runs, produces valid snapshot in object storage
- Restore from backup creates a working DB with data intact
- Version selection UI lists all supported versions per template; user picks 15 and gets PG 15 (not 16)

---

## Phase 9: Advanced Platform Features

**Deliverables**
- Preview environments per PR
- Cron jobs
- Background workers
- Multi-region clusters
- Blue/green deploy strategy
- Canary deploys with traffic splitting
- Service-to-service discovery UX (builds on Phase 2 mesh)
- Volume management UI polish (builds on Phase 8)
- Cost attribution per project + cluster

**Technical Specifics**
- Preview envs:
  - On PR opened: create ephemeral env named `pr-<number>`, build PR head, deploy, comment PR with preview URL
  - On PR sync: rebuild + redeploy
  - On PR close/merge: teardown env, clean up volumes (configurable — keep or delete)
  - Secrets: inherit from a designated source env (default: staging)
- Cron jobs:
  - Cron expression + container spec (image or build source)
  - History with per-run logs, duration, exit code
  - Timeout + kill policy
  - Concurrency policy: allow, forbid (skip if previous still running), replace
- Background workers: long-running containers with no Traefik routing, just supervised restart
- Multi-region clusters:
  - Cluster can span regions; WireGuard handles routing but latency becomes a factor
  - UI shows per-node region label and inter-node latency matrix
  - User can pin services to region via tags
- Blue/green:
  - Deploy full new version as "green" alongside "blue"
  - Health check green completely
  - Atomic traffic swap at Traefik level (router config switch)
  - Keep blue running for rollback window (configurable, default 15 min)
- Canary:
  - Deploy green at low replica count
  - Weighted routing: start at N% (configurable), step up at intervals or on manual confirmation
  - Abort on error rate threshold (triggers automatic rollback)
- Service-to-service discovery: UI surfaces `<app>.<project>.<cluster>.internal` DNS names per service, suggests env var refs
- Cost attribution: track CPU-hours, RAM-hours, storage-GB-hours, network egress per project/cluster; display in rollup dashboard

**Done When**
- PR opened on connected repo: preview URL in PR comment within 3 minutes, functional
- PR closed: env torn down, resources freed
- Cron job runs on schedule, failed runs flagged, logs retrievable
- Background worker stays running across deploys with correct supervision
- Multi-region cluster mesh stays healthy with <200ms intra-cluster hop
- Blue/green deploy: 10k-request load test during swap shows zero errors
- Canary at 10% routes ~10% of requests (statistical over 10k requests)
- Canary auto-aborts when simulated error rate exceeds threshold, rolls back within 1 minute
- Service-to-service: app A reaches app B via injected DNS name in same cluster
- Cost report shows per-project breakdown with reasonable numbers matching actual resource usage

---

## Phase 10: Hardening + Scale

**Deliverables**
- Control plane HA
- Database replication + failover
- Redis replication
- Agent auto-upgrade
- Platform backup/DR
- Full audit log search + export
- SSO (SAML, OIDC)
- Fine-grained RBAC (project + cluster level, custom roles)
- Rate limiting
- Quota system
- Usage metering hooks for billing

**Technical Specifics**
- Control plane: multiple API instances behind LB, stateless except for WebSocket affinity; agent connections sticky per instance
- PostgreSQL: primary + replica, automatic failover (Patroni, pg_auto_failover, or managed Postgres)
- Redis: Sentinel or Cluster mode
- Agent auto-upgrade: control plane publishes signed binary + version manifest; agents check periodically, self-update (download → verify checksum → swap binary → restart via systemd); rollback on post-upgrade health check failure
- Platform backup: PostgreSQL dumps + encrypted secrets export + config state, scheduled to object storage, tested restore procedure documented
- Audit log: searchable by actor, resource type, action, time range; exportable to CSV/JSON; retention per plan
- SSO:
  - SAML 2.0 IdP integration (Okta, Azure AD, Google)
  - OIDC providers (generic)
  - SCIM for user provisioning (v2 optional)
- RBAC:
  - Predefined roles: team owner, team admin, team member, project admin, project deployer, project viewer, cluster admin, cluster viewer
  - Custom roles: pick any combination of permissions from a full permissions catalog
  - Enforcement in all API endpoints with automated permission test suite
- Rate limiting: per-user + per-token + per-endpoint, 429 with `Retry-After`, counters in Redis
- Quotas: max servers, max clusters, max projects, max total CPU/RAM, max volumes, max storage; enforced on create, clear error on breach
- Usage metering: emits events (user, resource, quantity, timestamp) to a pluggable sink (webhook, Kafka, direct Stripe integration)

**Done When**
- Killing one control plane API instance: zero user-visible downtime, WebSockets reconnect to healthy instance within 5s
- PostgreSQL primary killed: failover under 30s, no data loss (verified with write-then-read test)
- Redis primary killed: failover, session state preserved
- Agent auto-upgrade: 100 test nodes upgrade successfully; simulated bad version rolls back on all nodes within 2 min
- DR drill: restore from backup on fresh infrastructure produces working platform with all user data intact
- Audit search for specific actor over 30 days returns in <2s
- SAML login works against Okta test tenant; user provisioned on first login
- Custom RBAC role: create "deployer-only" role, assign to user, verify they can deploy but not delete
- Rate limit returns 429 at threshold, resets per window
- Quota enforcement blocks 11th server when limit is 10, with error naming the limit
- Metering events match actual resource usage in a 24h test
