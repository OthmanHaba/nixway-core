# Nixway Core — System Architecture Diagram (Text)

> Text-only description of how every component connects, communicates, and collaborates.
> Use this to draw the diagram in any tool (Excalidraw, Draw.io, Lucidchart, etc.).

---

## 1. High-Level Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              EXTERNAL USERS                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────────────┐  │
│  │ Browser         │  │ Browser         │  │ Developer / CI Pipeline     │  │
│  │ (Operator       │  │ (Marketing      │  │                             │  │
│  │  Console)       │  │  Site + Docs)   │  │  nixway CLI                 │  │
│  └────────┬────────┘  └────────┬────────┘  └─────────────┬───────────────┘  │
└───────────┼────────────────────┼─────────────────────────┼──────────────────┘
            │                    │                         │
            ▼                    ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         EDGE / REVERSE PROXY                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Traefik v3 (Docker, optional profile)                              │    │
│  │  • TLS termination (Let's Encrypt)                                  │    │
│  │  • Host(console.nixway.dev)  →  apps/web-v2                         │    │
│  │  • Host(nixway.dev)          →  apps/site                           │    │
│  │  • Path(/api/*, /agent/*)    →  apps/api                            │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────┬────────────────────────────────────┘
                                         │
          ┌──────────────────────────────┼──────────────────────────────┐
          │                              │                              │
          ▼                              ▼                              ▼
┌─────────────────────┐    ┌─────────────────────────┐    ┌─────────────┐
│   apps/site         │    │   apps/web-v2           │    │  apps/cli   │
│   Next.js 15        │    │   Next.js 15            │    │  Go / Cobra │
│   Marketing + Docs  │    │   Operator Console      │    │  REST client│
│   Port 5373         │    │   Port 5273             │    │             │
│   Static export     │    │   Rewrites /api/* → API │    │             │
└─────────────────────┘    └───────────┬─────────────┘    └─────────────┘
                                       │
                         ┌─────────────┴─────────────┐
                         │                             │
                         ▼                             ▼
                ┌─────────────────┐          ┌─────────────────┐
                │  /api/* REST    │          │  /agent/*       │
                │  JSON           │          │  gRPC binary    │
                └────────┬────────┘          └────────┬────────┘
                         │                            │
                         └────────────┬───────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────┐
                    │     CONTROL PLANE                   │
                    │     apps/api  (Go)                  │
                    │     HTTP :8080  +  gRPC :9090       │
                    └─────────────────┬───────────────────┘
                                      │
         ┌────────────────────────────┼────────────────────────────┐
         │                            │                            │
         ▼                            ▼                            ▼
┌─────────────────┐        ┌─────────────────────┐      ┌──────────────────┐
│  HTTP Router    │        │  gRPC Server        │      │  Background      │
│  (go net/http   │        │  (Agent ConnMgr)    │      │  Worker          │
│   mux)          │        │  Bi-directional     │      │  (River Queue)   │
│                 │        │  streaming          │      │                  │
└────────┬────────┘        └──────────┬──────────┘      └────────┬─────────┘
         │                            │                          │
         └────────────────────────────┼──────────────────────────┘
                                      │
                                      ▼
        ┌─────────────────────────────────────────────────────────────┐
        │              INTERNAL SERVICE LAYER (Go packages)           │
        │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────────┐  │
        │  │ Auth    │ │ Build   │ │ Deploy  │ │ Database (managed)│  │
        │  │ Team    │ │ GitHub  │ │ Secret  │ │ Observability     │  │
        │  │ Project │ │ Prov.   │ │ Volume  │ │ Registry          │  │
        │  │ Cluster │ │ Mesh    │ │ Server  │ │ Template          │  │
        │  │ Onboard │ │ Status  │ │ Traffic │ │ Email / Audit     │  │
        │  └────┬────┘ └────┬────┘ └────┬────┘ └─────────┬─────────┘  │
        │       └───────────┴───────────┴────────────────┘            │
        │                         │                                   │
        │              ┌──────────┴──────────┐                        │
        │              │  db.Queries (sqlc)  │                        │
        │              │  Redis Client       │                        │
        │              └──────────┬──────────┘                        │
        └─────────────────────────┼───────────────────────────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            │                     │                     │
            ▼                     ▼                     ▼
     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
     │ PostgreSQL 16│     │ Redis 7      │     │ MinIO        │
     │ Primary DB   │     │ Sessions     │     │ S3-compatible│
     │ sqlc / pgx   │     │ Caching      │     │ Backups      │
     │ River Queue  │     │ Pub/Sub logs │     │ Artifacts    │
     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
            │                    │                    │
            │         ┌──────────┘                    │
            │         ▼                               │
            │  ┌──────────────┐                       │
            │  │VictoriaMetrics│                      │
            │  │ vmagent      │                       │
            │  │ TSDB + scraper                      │
            │  └──────────────┘                       │
            │                                         │
            └─────────────────────┬───────────────────┘
                                  │
                                  ▼
            ┌─────────────────────────────────────────────┐
            │           AGENT NODES (servers)             │
            │           apps/agent (Go binary)            │
            │                                             │
            │  ┌─────────────────────────────────────┐    │
            │  │  gRPC bi-directional stream         │    │
            │  │  to api:9090 (over WireGuard mesh)  │    │
            │  └─────────────────────────────────────┘    │
            │                                             │
            │  ┌──────────┐  ┌──────────────┐            │
            │  │ Docker   │  │ WireGuard    │            │
            │  │ Engine   │  │ Mesh Peer    │            │
            │  └────┬─────┘  └──────────────┘            │
            │       │                                    │
            │  ┌────┴────┐  ┌──────────────┐             │
            │  │Managed  │  │ Node Exporter│             │
            │  │Databases│  │ :9100 /metrics│            │
            │  │(pg,     │  └──────────────┘             │
            │  │ mysql,  │                               │
            │  │ redis,  │                               │
            │  │ mongo)  │                               │
            │  └─────────┘                               │
            └─────────────────────────────────────────────┘
```

---

## 2. Component Details

### 2.1 Edge — Traefik
- **Image**: `traefik:v3`
- **Profile**: `traefik` (optional, enabled for production)
- **Ports**: `:80` → redirect to HTTPS, `:443` → HTTPS
- **Networks**: `public` only
- **Certificates**: Let's Encrypt via HTTP-01 challenge
- **Routes**:
  - `Host(console.nixway.dev)` → `web-v2` service
  - `Host(nixway.dev)` → `site` service
  - `PathPrefix(/api)` or `PathPrefix(/agent)` → `api` service

### 2.2 Frontend Applications

| App | Framework | Runtime | Public Port | Purpose |
|-----|-----------|---------|-------------|---------|
| `apps/site` | Next.js 15 | Standalone Node | 5373 | Marketing site, docs, landing pages |
| `apps/web-v2` | Next.js 15 | Standalone Node | 5273 | Operator console (dashboard, deploys, DBs) |
| `apps/web` | Vite + React | Node dev server | 5173 | Legacy / experimental console |
| `apps/cli` | Go + Cobra | Native binary | — | Developer CLI (auth, teams, tokens) |

**Frontend → API connectivity**:
- `web-v2` uses `next.config.ts` rewrites: `/api/:path*` → `NIXWAY_API_URL/api/:path*`
- `site` is fully static; only consumes `NIXWAY_CONSOLE_URL` for sign-in links
- `cli` speaks directly to the REST API over HTTPS

### 2.3 Control Plane — `apps/api`

Single Go binary. On boot it initializes every internal service and exposes two servers:

**HTTP Server (:8080)**
- `net/http` mux with path-based routing
- Public routes: auth (signup, login, verify, forgot-password, reset-password), GitHub webhooks, agent binary download
- Protected routes: wrapped with `middleware.Auth()` — everything under `/api/v1/teams`, `/api/v1/projects`, `/api/v1/apps`, `/api/v1/databases`, etc.
- Global middleware: RequestID → Logging → Recover → CORS

**gRPC Server (:9090)**
- `google.golang.org/grpc`
- Service: `agent.v1.AgentService`
- RPCs:
  - `Connect(stream AgentMessage) returns (stream ControlMessage)` — persistent bi-directional stream for every agent
  - `Register(RegisterRequest) returns (RegisterResponse)` — initial agent onboarding + mTLS certificate issuance

**Internal services initialized in main.go** (dependency-injected into the router):

```
config.Load()
  ├─→ db.NewPool()       → queries (sqlc)
  ├─→ redis.NewClient()  → redisClient
  ├─→ redis.NewSessionStore() + auth.NewSessionManager() → sessions
  ├─→ email.Sender (smtp | resend | console)
  ├─→ audit.NewWriter()
  ├─→ crypto.MasterKeyFromHex()
  ├─→ agent.NewConnManager() + agent.NewServer() → grpcServer
  ├─→ server.NewOnboardingService()
  ├─→ provisioner.NewService()          (SSH provisioning)
  ├─→ server.NewStatusWatcher()         (background goroutine)
  ├─→ cluster.NewService()
  ├─→ mesh.NewManager()
  ├─→ githubsvc.NewService()
  ├─→ secret.NewService()
  ├─→ project.NewService()
  ├─→ app.NewService()
  ├─→ build.NewService()                (triggers builds on agents)
  ├─→ deploy.NewService()               (container lifecycle, autoscaling)
  ├─→ containerlog.NewService()         (log retention background loop)
  ├─→ observability.NewService()        (metrics, alerts, vmagent configs)
  ├─→ template.NewRegistry()            (static catalog of DB/cache types)
  ├─→ volume.NewService()               (loopback volume lifecycle)
  ├─→ platform.NewMinIOClient()         (S3 backups, optional)
  └─→ database.NewService()             (managed DB provisioning + backups)

api.NewRouter(...) → api.NewServer(...) → srv.Start()
```

**Cross-wiring between services** (to break import cycles):
- `agentSrv.SetDeployTriggerer(deploySvc)` — auto-deploy after build completes
- `agentSrv.SetObservabilityRecorder(observabilitySvc)` — record deployment events
- `agentSrv.SetVolumeResultHandler(volumeSvc.HandleResult)`
- `agentSrv.SetDatabaseAlterUserResultHandler(databaseSvc.HandleAlterUserResult)`
- `agentSrv.SetDatabaseQueryResultHandler(databaseSvc.HandleQueryResult)`
- `agentSrv.SetBackupResultHandler(databaseSvc.HandleBackupResult)`
- `agentSrv.SetRestoreResultHandler(databaseSvc.HandleRestoreResult)`
- `agentSrv.SetDatabaseDeployResultHandler(databaseSvc.HandleDeployResult)`
- `buildSvc.SetDeployTriggerer(deploySvc)` — auto-deploy after successful build
- `deploySvc.SetDatabaseLinkResolver(databaseSvc)` — inject linked DB env vars into apps
- `databaseSvc.SetRedeployTrigger(deploySvc)` — redeploy apps after credential rotation
- `databaseSvc.SetRedis(redisClient)` — query rate-limiting

### 2.4 Background Worker — `apps/worker`

- **Queue**: River (PostgreSQL-backed, uses `riverpgxv5`)
- **Migration**: `rivermigrate` applied on worker boot
- **Workers**:
  - `SendEmailWorker` — sends transactional emails via SMTP, Resend, or console logger
  - `CleanupExpiredInvitesWorker` — deletes stale team invites
- **Concurrency**: `MaxWorkers: 10` on the default queue
- **Network**: `internal` only (no public exposure)

### 2.5 Data & Observability Stores

| Store | Image | Port | Purpose | Consumers |
|-------|-------|------|---------|-----------|
| **PostgreSQL** | `postgres:16-alpine` | 5432 | Primary DB, migrations, River queue | API, Worker |
| **Redis** | `redis:7-alpine` | 6379 | Sessions, caching, real-time log Pub/Sub | API |
| **VictoriaMetrics** | `victoriametrics/victoria-metrics` | 8428 | Time-series metrics DB | API, vmagent |
| **vmagent** | `victoriametrics/vmagent` | 8429 | Prometheus scraper → remote-writes to VM | API configures its scrape targets |
| **MinIO** | `minio/minio` | 9000 / 9001 | S3-compatible object storage for backups | API (`platform.MinIOClient`) |

### 2.6 Agent Node — `apps/agent`

Installed on every managed server. Lightweight Go binary.

**Startup flow**:
```
1. Parse flags: --server, --id, --metrics-listen, --metrics-path
2. If no --id, use OS hostname
3. Create gRPC client → api:9090
4. Start local Prometheus metrics server (:9100)
5. Reconcile any existing loopback volume mounts
6. ConnectWithRetry() → opens bi-di gRPC stream
7. Send immediate Heartbeat
8. Enter receiveLoop() → blocks reading ControlMessages
```

**Receive loop handles these control messages** (from `proto/agent/v1/agent.proto`):

| ControlMessage | Handler Function | What the agent does |
|----------------|------------------|---------------------|
| `ExecCommand` | `HandleExecCommand` | Runs shell command, streams stdout/stderr back |
| `ProvisionCommand` | `HandleProvisionCommand` | Executes setup script, reports output |
| `SSHKeyInstall` | `HandleSSHKeyInstall` | Adds/removes authorized SSH keys |
| `WireGuardKeygen` | `HandleWireGuardKeyGen` | Generates WG keypair, returns public key |
| `WireGuardApply` | `HandleWireGuardApply` | Writes wg0.conf, brings up interface |
| `WireGuardTeardown` | `HandleWireGuardTeardown` | Removes interface |
| `DNSUpdateHosts` | `HandleDNSUpdate` | Writes /etc/hosts + Corefile, restarts CoreDNS |
| `BuildCommand` | `HandleBuildCommand` | Clones repo, detects builder, builds image, pushes |
| `DeployCommand` | `HandleDeployCommand` | docker run with Traefik labels, health checks |
| `StopContainer` | `HandleStopContainerCommand` | docker stop + optional Traefik cleanup |
| `RestartContainer` | `HandleRestartContainerCommand` | docker restart |
| `ContainerInspect` | `HandleContainerInspectCommand` | docker inspect, returns structured JSON |
| `ImagePull` | `HandleImagePullCommand` | docker pull from peer server over mesh |
| `ContainerLogs` | `HandleContainerLogsCommand` | docker logs, stream via gRPC |
| `ContainerExec` | `HandleContainerExecCommand` | docker exec -it, bidirectional PTY |
| `ContainerExecInput` | `RouteExecInput` | Forwards stdin/resize to active exec session |
| `ServerLogs` | `HandleServerLogsCommand` | journalctl/syslog stream |
| `ServerCleanup` | `HandleServerCleanupCommand` | docker prune, image cleanup |
| `TrafficRoute` | `HandleTrafficRouteCommand` | Updates local Traefik dynamic config |
| `VolumeCreate` | `HandleVolumeCreate` | Creates loopback ext4 image, mounts |
| `VolumeDelete` | `HandleVolumeDelete` | Unmounts, deletes image file |
| `VolumeMove` | `HandleVolumeMove` | rsync over WireGuard to peer, rebinds |
| `VolumeSnapshot` | `HandleVolumeSnapshot` | Creates snapshot image |
| `VolumeResize` | `HandleVolumeResize` | resize2fs + loopback resize |
| `DatabaseAlterUser` | `HandleDatabaseAlterUser` | docker exec ALTER USER for credential rotation |
| `DatabaseQuery` | `HandleDatabaseQuery` | Connects to DB, runs query, returns structured result |
| `Backup` | `HandleBackup` | pg_dump/mysqldump/mongodump/redis-bgsave → upload to MinIO |
| `Restore` | `HandleRestore` | Download from MinIO → restore into container |

**Agent → Server messages** (reported back on the same stream):
- `Heartbeat` — periodic keepalive
- `HealthReport` — CPU %, memory used/total, disk usage
- `ResourceReport` — CPU model, cores, kernel version, Docker version, network interfaces
- `MetricReport` — per-container Docker stats (CPU, memory, network, block I/O, restart count)
- `BuildOutput` — build logs, phase (cloning/detecting/building), success/failure
- `DeployOutput` — deploy phase (starting/health_checking/healthy/failed), container ID
- `ProvisionOutput` — script stdout, finished, success/error
- `MeshHealthReport` — peer reachability, RTT ms, last handshake seconds
- `VolumeResult` — success, size, used bytes, snapshot path
- `DatabaseAlterUserResult` — success/error
- `DatabaseQueryResult` — columns, rows, raw text, execution time
- `BackupResult` — success, size, storage path in MinIO
- `RestoreResult` — success/error

---

## 3. Network Topology

```
┌─────────────────────────────────────────────────────────────┐
│  PUBLIC NETWORK  (nixway-public)                            │
│                                                             │
│   [Traefik] ←──→ [web-v2] ←──→ [site]                      │
│       ↑                                                       │
│       └────────────────────────────────────┐                │
│                                            │                │
│   External traffic hits Traefik :80/:443   │                │
│   Traefik forwards /api/* to api :8080     │                │
│   Traefik forwards Host() to frontends     │                │
└────────────────────────────────────────────┼────────────────┘
                                             │
┌────────────────────────────────────────────┼────────────────┐
│  INTERNAL NETWORK  (nixway-internal)       │                │
│                                            │                │
│   [api] ←──→ [postgres]                    │                │
│      ↑    ←──→ [redis]                     │                │
│      │    ←──→ [worker]                    │                │
│      │    ←──→ [minio]                     │                │
│      │    ←──→ [victoria-metrics]          │                │
│      │    ←──→ [vmagent]                   │                │
│      │                                     │                │
│      └─────────────────────────────────────┘                │
│         gRPC :9090 to agents (over WireGuard or public)     │
└─────────────────────────────────────────────────────────────┘
```

- **api** is the only service attached to **both** `public` and `internal` networks
- **web-v2** is on both networks (needs to reach API internally for rewrites)
- **site** is on `public` only (fully static, no backend calls)
- **worker**, **postgres**, **redis**, **minio**, **victoria-metrics**, **vmagent** are `internal` only

---

## 4. Critical Data Flows

### Flow A: Web Request (User → Console → API → DB)
```
Browser
  → HTTPS → Traefik :443
    → Host(console.nixway.dev) → web-v2 :80
      → /api/v1/teams → next.config.ts rewrite
        → HTTP → api:8080
          → middleware.Auth() (validates session in Redis)
            → handler.TeamHandler
              → db.Queries (sqlc) → PostgreSQL
                → respond.JSON → web-v2 → Browser
```

### Flow B: Build & Deploy Pipeline
```
User clicks "Build" in web-v2
  → POST /api/v1/apps/{id}/builds
    → api: build.Service
      → store build record in Postgres
      → find agent with gRPC connection (ConnMgr)
        → gRPC BuildCommand → agent
          → agent clones repo (using GitHub installation token)
          → detects builder (dockerfile / nixpacks / buildpacks / railpack)
          → builds image, pushes to registry
          → streams BuildOutput back to api
      → api marks build success
      → build.Service triggers deploy.Service
        → gRPC DeployCommand → target agent(s)
          → docker pull image
          → docker run with Traefik labels + env vars + volume mounts
          → health check loop
          → streams DeployOutput back to api
        → api updates deployment status
    → User sees live logs via Redis Pub/Sub (SSE/WebSocket)
```

### Flow C: Server Onboarding (Adding a new node)
```
User clicks "Add Server" in web-v2
  → POST /api/v1/teams/{id}/servers
    → api: onboardingSvc
      → generates unique agent ID
      → creates agent download URL (/agent/download/{arch})
      → generates install script with --server and --id flags
    → User copies script, runs on new VM / bare metal
      → downloads agent binary via Traefik → api
      → agent starts: ./agent --server=api:9090 --id=<uuid>
        → gRPC Register → api
          → api issues mTLS certificate (signed by internal CA)
        → agent opens persistent Connect stream
          → api provisions server via SSH (ProvisionCommand)
            → agent runs setup scripts
            → reports ProvisionOutput
          → api marks server "active"
          → api triggers WireGuard mesh regeneration
            → mesh.Manager sends WireGuardKeygen to all peers
            → collects public keys
            → sends WireGuardApply to all peers with full mesh config
```

### Flow D: Managed Database Lifecycle
```
User clicks "New Database" in web-v2
  → POST /api/v1/projects/{id}/databases
    → api: database.Service
      → picks template (postgres:16, mysql:8, redis:7, mongo:7)
      → provision via deploy.Service (DeployCommand to agent)
        → agent starts DB container with volume mount + health check
        → agent reports DeployOutput (healthy)
      → database.Service creates default users + secrets
      → stores connection info in Postgres

User links DB to an App
  → POST /api/v1/projects/{id}/databases/{id}/links
    → api: database.BuildEnvForApp()
    → next deploy of the app injects DB env vars automatically

User rotates credentials
  → POST /api/v1/projects/{id}/databases/{id}/rotate
    → api: database.Service generates new password
      → gRPC DatabaseAlterUserCommand → agent
        → agent runs ALTER USER inside container
        → reports DatabaseAlterUserResult
      → api updates secret
      → database.Service triggers deploySvc.RedeployAppLatest()
        → all linked apps restart with new env vars

User creates backup
  → POST /api/v1/projects/{id}/databases/{id}/backups
    → api: database.Service generates MinIO presigned PUT URL
      → gRPC BackupCommand → agent
        → agent runs pg_dump / mysqldump / mongodump / redis-bgsave
        → uploads file to MinIO
        → reports BackupResult (size, storage_path)
      → api stores backup record in Postgres
```

### Flow E: Autoscaling
```
Agent (every 15-30s)
  → gRPC MetricReport → api
    → api: observability.Service remote-writes to VictoriaMetrics

deploy.Service background loop (every 60s)
  → queries VictoriaMetrics for app CPU/memory usage
  → evaluates autoscaling rules
  → if threshold exceeded:
    → gRPC DeployCommand → additional agent(s)
      → new container starts
    → gRPC TrafficRoute → update Traefik weights
      → traffic gradually shifts to new replicas
```

### Flow F: Real-Time Logs
```
User clicks "View Logs" in web-v2
  → GET /api/v1/apps/{id}/logs (SSE or WebSocket upgrade)
    → api: deployH.ContainerLogs
      → subscribes to Redis Pub/Sub channel "logs:{app_id}"
      → sends gRPC ContainerLogsCommand → agent
        → agent tails docker logs
        → streams ContainerLogsOutput back to api
          → api publishes chunks to Redis Pub/Sub
      → web-v2 SSE connection receives chunks and renders them
```

---

## 5. Technology Stack Summary

| Layer | Technology |
|-------|------------|
| **Language (Backend)** | Go 1.24 |
| **Language (Frontend)** | TypeScript, React 19, Next.js 15 |
| **HTTP Server** | `net/http` (standard library) |
| **gRPC** | `google.golang.org/grpc` |
| **Database ORM/Query** | `sqlc` (code-generated from SQL) + `pgx/v5` |
| **Job Queue** | River (PostgreSQL-backed) |
| **Cache / Sessions** | Redis (`go-redis/v9`) |
| **Observability DB** | VictoriaMetrics (Prometheus-compatible) |
| **Object Storage** | MinIO (S3-compatible) |
| **Reverse Proxy** | Traefik v3 |
| **Container Runtime** | Docker Engine (on agent nodes) |
| **Mesh Networking** | WireGuard |
| **DNS** | CoreDNS (containerized on agents) |
| **Metrics Exposure** | Node Exporter (:9100) + custom agent metrics |
| **Build Systems** | Dockerfile, Nixpacks, Buildpacks, Railpack |

---

## 6. File Mapping (Where to find each component)

| Component | Entry Point | Internal Packages |
|-----------|-------------|-------------------|
| API Server | `apps/api/main.go` | `internal/api/*`, `internal/*/service.go` |
| Agent | `apps/agent/main.go` | `internal/agent/*` |
| Worker | `apps/worker/main.go` | `internal/job/*` |
| CLI | `apps/cli/main.go` | `apps/cli/cmd/*.go` |
| Web Console | `apps/web-v2/app/` | Next.js app router |
| Marketing Site | `apps/site/app/` | Next.js app router |
| Proto Definitions | `proto/agent/v1/agent.proto` | `internal/agent/proto/` |
| SQL Migrations | `sql/migrations/` | Applied by `migrate` Docker target |
| SQL Queries | `sql/queries/` | Compiled by `sqlc` into `internal/db/` |
