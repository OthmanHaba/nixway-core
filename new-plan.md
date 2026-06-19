Nixway Core PaaS - Complete Analysis & Migration Plan

20-Agent Analysis Team

2026-05-24

Table of Contents

# Nixway Core PaaS - Complete Analysis & Strategic Plan

**Document Version:** 1.0 **Date:** January 2026 **Status:** Comprehensive Master Document **Synthesized From:** 19 specialist agent analyses

# Executive Summary

## Platform Overview

Nixway Core is a self-hosted Platform-as-a-Service (PaaS) solution with a microservices architecture featuring Go-based backend services, a React SPA frontend, and PostgreSQL as the primary data store. The platform enables teams to deploy, manage, and scale containerized applications across bare metal and cloud servers with features including automated CI/CD pipelines, WireGuard mesh networking, managed database services, auto-scaling, and observability tooling.

## Overall Platform Maturity Score: 6.5/10

| Dimension             | Score  | Assessment                                                         |
| --------------------- | ------ | ------------------------------------------------------------------ |
| Backend Architecture  | 7.5/10 | Go microservices, gRPC, clean separation of concerns               |
| Frontend Architecture | 5.5/10 | Functional React SPA but legacy TanStack Router v0, Vite bundler   |
| Database Design       | 7.0/10 | Good schema with 60+ tables, proper migrations, some JSONB overuse |
| API Design            | 6.5/10 | RESTful patterns, needs OpenAPI docs, no rate limiting             |
| Security              | 6.0/10 | Basic auth, RBAC, needs 2FA, better secret management              |
| Deployment Pipeline   | 7.0/10 | Build system, rolling deploys, good foundation                     |
| Observability         | 6.5/10 | VictoriaMetrics, basic alerting, no distributed tracing            |
| Auto-Scaling          | 4.0/10 | Hardcoded 30s loop, only 2 metrics, full redeploy on scale         |
| Cluster/Mesh          | 7.0/10 | WireGuard mesh, CoreDNS, health monitoring                         |
| DevEx (CLI/UI)        | 4.5/10 | Minimal CLI (5 commands), functional but dated UI                  |

## Top 5 Critical Issues (P0)

| #   | Issue                                                         | Impact                                | Effort to Fix |
| --- | ------------------------------------------------------------- | ------------------------------------- | ------------- |
| 1   | **Auto-scaling triggers full redeploy (30-120s)**             | Makes scaling useless under load      | 4-6 weeks     |
| 2   | **No API rate limiting**                                      | Security vulnerability, abuse risk    | 1-2 weeks     |
| 3   | **No billing/usage metering**                                 | Blocks any commercial offering        | 6-8 weeks     |
| 4   | **Duration tracking in autoscaling is broken**                | 1-second spikes trigger scale actions | 1-2 weeks     |
| 5   | **No preview environments, cron jobs, or background workers** | Core PaaS features missing            | 8-12 weeks    |

## Top 5 Strengths

| #   | Strength                                                                       | Competitive Advantage                            |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------ |
| 1   | **Comprehensive managed database service** (PostgreSQL, MySQL, MongoDB, Redis) | Credential rotation, browser tooling, backups    |
| 2   | **WireGuard mesh networking with DNS**                                         | Private networking between all cluster servers   |
| 3   | **Placement strategies** (spread/binpack/pinned)                               | Intelligent workload distribution                |
| 4   | **Full audit logging**                                                         | Immutable operation history for compliance       |
| 5   | **Build system with multiple builders**                                        | GitHub integration, Nixpacks, Docker, Buildpacks |

## Migration Effort Summary

| Migration                      | Timeline   | Effort | Risk   |
| ------------------------------ | ---------- | ------ | ------ |
| Vite → Next.js 15 (App Router) | 8-10 weeks | High   | Medium |
| TanStack Router v0 → v1        | 2-3 weeks  | Medium | Low    |
| Component library migration    | 4-6 weeks  | Medium | Low    |
| Auto-scaling engine redesign   | 4-6 weeks  | High   | High   |
| UI/UX design system adoption   | 6-8 weeks  | Medium | Medium |

**Total estimated effort to address all critical items: 28-36 weeks (7-9 months)**

# Part 1: Current State Assessment

## 1.1 Architecture Overview

### System Architecture Diagram

+------------------------------------------------------------------+  
| NIXWAY CORE PaaS |  
+------------------------------------------------------------------+  
| |  
| +------------------+ +------------------+ |  
| | React SPA |&lt;---&gt;| Go API Server | |  
| | (Vite + TS) | | (Echo Router) | |  
| +------------------+ +--------+---------+ |  
| | | |  
| | TanStack Query | gRPC/HTTP |  
| v v |  
| +------------------+ +--------+---------+ |  
| | State Mgmt | | Business Logic | |  
| | (TanStack) | | Services | |  
| +------------------+ +--------+---------+ |  
| | |  
| +--------------+--------------+ |  
| | | | |  
| +----------v--+ +-------v------+ +----v------+ |  
| | PostgreSQL | | Redis | | Victoria | |  
| | (Primary) | | (Cache/ | | Metrics | |  
| | | | PubSub) | | (TSDB) | |  
| +-------------+ +--------------+ +-----------+ |  
| |  
| +------------------+ +------------------+ |  
| | Agent (Go) |&lt;---&gt;| Traefik LB | |  
| | (Per Server) | | (Per Node) | |  
| +------------------+ +------------------+ |  
| |  
+------------------------------------------------------------------+

### Technology Stack

| Layer              | Technology      | Version | Status                |
| ------------------ | --------------- | ------- | --------------------- |
| Frontend Framework | React           | 18.x    | Current               |
| Frontend Build     | Vite            | 5.x     | Migrate to Next.js    |
| Router             | TanStack Router | 0.x     | Migrate to v1         |
| Query Client       | TanStack Query  | 5.x     | Keep                  |
| UI Components      | Custom + Radix  | \-      | Consolidate to shadcn |
| Styling            | Tailwind CSS    | 3.x     | Upgrade to v4         |
| Backend            | Go              | 1.21+   | Keep                  |
| Web Framework      | Echo            | 4.x     | Keep                  |
| ORM                | sqlc            | 1.x     | Keep                  |
| Database           | PostgreSQL      | 15+     | Keep                  |
| Cache              | Redis           | 7.x     | Keep                  |
| Metrics            | VictoriaMetrics | 1.x     | Keep                  |
| Message Queue      | RabbitMQ        | 3.x     | Keep                  |
| Load Balancer      | Traefik         | 3.x     | Keep                  |
| Networking         | WireGuard       | \-      | Keep                  |
| DNS                | CoreDNS         | \-      | Keep                  |
| Container Runtime  | Docker          | 24+     | Keep                  |

## 1.2 What's Implemented Well

### Backend Services (High Quality)

| Service            | Location                | Assessment                               |
| ------------------ | ----------------------- | ---------------------------------------- |
| API Server         | cmd/server/             | Clean Echo routing, middleware chain     |
| Agent              | cmd/agent/              | gRPC communication, container management |
| Job Runner         | cmd/jobrunner/          | Background task processing               |
| Build System       | internal/build/         | Multiple builder support                 |
| Deployment         | internal/deploy/        | Rolling deploys, health checks           |
| Database Service   | internal/database/      | 4 DB types, credential rotation          |
| Cluster Management | internal/cluster/       | WireGuard mesh, member management        |
| Observability      | internal/observability/ | Metrics, alerts, scrape configs          |
| Secret Management  | internal/secret/        | AES-GCM encryption                       |
| SSH Key Management | internal/sshkey/        | ed25519/RSA generation                   |
| GitHub Integration | internal/github/        | App-based webhooks                       |
| Template System    | internal/template/      | DB provisioning templates                |

### Database Schema Strengths

- **60+ tables** with proper foreign key relationships
- **Migration system** using golang-migrate
- **JSONB columns** for flexible configuration (apps, servers)
- **Proper indexing** on foreign keys and query patterns
- **Audit trail** on all major operations
- **Soft deletes** where appropriate

### Infrastructure

- **Docker-based deployment** with clear container boundaries
- **Environment-based configuration** (.env files)
- **Health check endpoints** (/healthz)
- **Structured logging** with configurable levels

## 1.3 What's Implemented Wrong

### Critical Implementation Issues

| #   | Issue                                                                        | Location                 | Severity     |
| --- | ---------------------------------------------------------------------------- | ------------------------ | ------------ |
| 1   | Auto-scaling triggers **full deployment** instead of fast replica adjustment | service.go:852-862       | **CRITICAL** |
| 2   | Autoscaling duration_seconds field **stored but never used**                 | autoscaling.sql:18       | **CRITICAL** |
| 3   | Server-level metrics used for **app-level scaling decisions**                | server_metrics.sql:10-26 | **CRITICAL** |
| 4   | Only **2 metrics** supported (hardcoded switch)                              | service.go:878-887       | **CRITICAL** |
| 5   | Fixed **30-second evaluation loop** for all apps                             | service.go:127           | **HIGH**     |
| 6   | No scale-to-zero capability                                                  | service.go:366           | **HIGH**     |
| 7   | TanStack Router v0 (beta) with unstable API                                  | Frontend routes          | **HIGH**     |
| 8   | No API rate limiting middleware                                              | internal/api/middleware/ | **HIGH**     |
| 9   | No resource quotas or usage metering                                         | Platform-wide            | **HIGH**     |
| 10  | Frontend uses mixed component patterns                                       | Various page components  | **MEDIUM**   |
| 11  | No health check customization per app                                        | App model                | **MEDIUM**   |
| 12  | No graceful shutdown handling per app                                        | Agent deploy             | **MEDIUM**   |

### Code Quality Issues

| Pattern               | Location       | Issue                        | Recommendation                  |
| --------------------- | -------------- | ---------------------------- | ------------------------------- |
| metricValue()         | service.go:878 | Hardcoded 2-metric switch    | Pluggable metric provider       |
| EvaluateAutoscaling() | service.go:798 | Sequential sync evaluation   | Async parallel with worker pool |
| ScaleApp()            | service.go:361 | Full redeploy on every scale | Fast replica adjustment         |
| Frontend routing      | Multiple       | Beta router API              | Migrate to stable v1            |
| Component imports     | Multiple       | Inconsistent patterns        | Standardize on shadcn/ui        |

## 1.4 What's Not Implemented (Critical Gaps)

### Missing Core PaaS Features

| Feature                               | Priority | Competitors              | Effort     |
| ------------------------------------- | -------- | ------------------------ | ---------- |
| Preview Environments (PR-based)       | P0       | Railway, Render, DO Apps | 3-4 weeks  |
| Pipeline Stages (build→test→deploy)   | P0       | All major PaaS           | 4-6 weeks  |
| Cron Jobs / Scheduled Tasks           | P0       | Railway, Render, Fly.io  | 2-3 weeks  |
| Background Workers                    | P0       | All major PaaS           | 2-3 weeks  |
| Blue-Green Deployments                | P1       | Render, Heroku           | 3-4 weeks  |
| Canary Deployments with Auto-Rollback | P1       | Fly.io                   | 4-5 weeks  |
| Maintenance Mode                      | P1       | Heroku                   | 1 week     |
| Release Management (promote)          | P1       | All major PaaS           | 2-3 weeks  |
| Static Site Hosting                   | P1       | Railway, Render, DO Apps | 2-3 weeks  |
| Function-as-a-Service                 | P3       | Fly.io (Machines)        | 8-10 weeks |

### Missing Platform Features

| Feature                     | Priority | Effort    |
| --------------------------- | -------- | --------- |
| Billing & Usage Metering    | P0       | 6-8 weeks |
| Resource Quotas & Limits    | P0       | 3-4 weeks |
| API Rate Limiting           | P0       | 1-2 weeks |
| Plan Tiers (Free/Hobby/Pro) | P0       | 2-3 weeks |
| User-Managed Webhooks       | P1       | 2-3 weeks |
| Status Page / SLA           | P1       | 2-3 weeks |
| Cost Alerts & Budgets       | P1       | 1-2 weeks |

### Missing Developer Experience Features

| Feature                               | Priority | Effort    |
| ------------------------------------- | -------- | --------- |
| CLI Enhancement (deploy, logs, env)   | P0       | 4-5 weeks |
| OpenAPI / Swagger Documentation       | P1       | 2 weeks   |
| API Client Libraries (Go, JS, Python) | P1       | 4-6 weeks |
| Terraform Provider                    | P1       | 4-5 weeks |
| GitHub Actions Integration            | P1       | 1-2 weeks |
| VS Code Extension                     | P2       | 3-4 weeks |
| PWA Support                           | P2       | 2 weeks   |

### Missing Infrastructure Features

| Feature                              | Priority | Effort    |
| ------------------------------------ | -------- | --------- |
| SSL Certificate Lifecycle Management | P0       | 1-2 weeks |
| Custom Health Check Configuration    | P0       | 2-3 weeks |
| Sticky Sessions                      | P1       | 1-2 weeks |
| Graceful Shutdown Handling           | P1       | 2 weeks   |
| CDN / Edge Caching                   | P1       | 2-3 weeks |
| Circuit Breakers                     | P2       | 2-3 weeks |
| DDoS Protection                      | P2       | 1-2 weeks |

### Missing Operational Features

| Feature                               | Priority | Effort     |
| ------------------------------------- | -------- | ---------- |
| Log Aggregation with Full-Text Search | P0       | 3-4 weeks  |
| Distributed Tracing (OpenTelemetry)   | P1       | 3-4 weeks  |
| APM / Performance Monitoring          | P1       | 3-4 weeks  |
| Point-in-Time Recovery                | P1       | 3-4 weeks  |
| Read Replicas                         | P1       | 4-5 weeks  |
| Multi-Region Support                  | P2       | 8-10 weeks |

# Part 2: Detailed Analysis by Domain

## 2.1 Authentication & Authorization

### Current Implementation

Nixway Core implements a dual authentication system supporting both session-based (cookie) and API token-based (Bearer) authentication.

**Session Authentication Flow:**

1\. POST /api/v1/auth/login → email/password  
2\. Server validates credentials (bcrypt)  
3\. Session token generated, stored in HTTP-only cookie  
4\. Cookie sent with every subsequent request  
5\. Protected routes validate session via middleware

**API Token Authentication Flow:**

1\. User creates token via UI (Settings > API Tokens)  
2\. Server generates secure random token, stores SHA-256 hash  
3\. Token returned once to user (plain text)  
4\. API requests use: Authorization: Bearer &lt;token&gt;  
5\. Server validates token hash, checks scopes

### Authorization Model

**Role-Based Access Control (RBAC):**

| Role   | Level | Permissions                              |
| ------ | ----- | ---------------------------------------- |
| Owner  | 3     | Full control, team deletion, billing     |
| Admin  | 2     | Member management, settings, deployments |
| Member | 1     | View resources, create deployments       |

**API Token Scopes:**

tokens:\*, teams:\*, members:\*, invites:\*  
servers:\*, audit:\*  
servers:read, servers:write

### Strengths

| Feature            | Assessment                                    |
| ------------------ | --------------------------------------------- |
| Session management | Secure HTTP-only cookies, configurable expiry |
| API token scoping  | Fine-grained permission control               |
| Password hashing   | bcrypt with proper cost factor                |
| Email verification | Token-based verification flow                 |
| Password reset     | Secure token-based reset with expiry          |
| Audit logging      | All auth events logged with IP/timestamp      |

### Issues & Recommendations

| Severity | Issue                               | Recommendation                                      |
| -------- | ----------------------------------- | --------------------------------------------------- |
| HIGH     | No 2FA/MFA support                  | Implement TOTP-based 2FA                            |
| HIGH     | No SSO/SAML integration             | Add OAuth2/OIDC provider support                    |
| MEDIUM   | Session token stored in cookie only | Consider short-lived access tokens + refresh tokens |
| MEDIUM   | No API rate limiting per token      | Add per-token rate limits                           |
| LOW      | No session invalidation API         | Add force-logout all sessions endpoint              |

### Implementation Priority: P1

**Effort Estimate:** 3-4 weeks for 2FA, 4-6 weeks for SSO

## 2.2 Frontend Architecture

### Current Stack

| Technology      | Version | Purpose                         |
| --------------- | ------- | ------------------------------- |
| React           | 18.x    | UI framework                    |
| TypeScript      | 5.x     | Type safety                     |
| Vite            | 5.x     | Build tool (Migrate to Next.js) |
| TanStack Router | 0.x     | Routing (Migrate to v1)         |
| TanStack Query  | 5.x     | Data fetching                   |
| Tailwind CSS    | 3.x     | Styling (Upgrade to v4)         |
| shadcn/ui       | latest  | Component primitives            |
| Radix UI        | latest  | Headless UI primitives          |
| Recharts        | latest  | Charts                          |
| xterm.js        | latest  | Terminal component              |
| zustand         | latest  | State management                |

### Page Inventory (Implemented)

| Route                           | Component            | Auth      | Description           |
| ------------------------------- | -------------------- | --------- | --------------------- |
| /signup                         | SignupPage           | Public    | User registration     |
| /login                          | LoginPage            | Public    | User login            |
| /forgot-password                | ForgotPasswordPage   | Public    | Password recovery     |
| /verify-email/\$token           | VerifyEmailPage      | Public    | Email verification    |
| /reset-password/\$token         | ResetPasswordPage    | Public    | Password reset        |
| /github/callback                | GitHubCallbackPage   | Public    | GitHub OAuth callback |
| /dashboard                      | DashboardPage        | Protected | Team dashboard        |
| /servers/\$teamId               | ServersPage          | Protected | Server management     |
| /servers/\$teamId/\$serverId    | ServerDetailPage     | Protected | Server detail         |
| /clusters/\$teamId              | ClustersPage         | Protected | Cluster management    |
| /clusters/\$teamId/\$clusterId  | ClusterDetailPage    | Protected | Cluster detail        |
| /projects/\$teamId              | ProjectsPage         | Protected | Project management    |
| /projects/\$teamId/\$projectId  | ProjectDetailPage    | Protected | Project detail        |
| /databases/\$teamId             | DatabasesPage        | Protected | Database management   |
| /databases/\$teamId/\$projectId | ProjectDatabasesPage | Protected | Project databases     |
| /volumes/\$teamId               | VolumesPage          | Protected | Volume management     |
| /ssh-keys/\$teamId              | SSHKeysPage          | Protected | SSH key management    |
| /settings/\$teamId              | SettingsPage         | Protected | Team settings         |
| /teams                          | TeamsPage            | Protected | Team list             |
| /teams/\$teamId                 | TeamDetailPage       | Protected | Team detail           |

### Component Inventory

**shadcn/ui Components (Used):** Accordion, Alert, AlertDialog, AspectRatio, Avatar, Badge, Button, Calendar, Card, Checkbox, Collapsible, Command, ContextMenu, Dialog, DropdownMenu, Form, HoverCard, Input, Label, Menubar, NavigationMenu, Popover, Progress, RadioGroup, Resizable, ScrollArea, Select, Separator, Sheet, Skeleton, Slider, Switch, Table, Tabs, Textarea, Toast, Toggle, ToggleGroup, Tooltip

**Custom Components:** ActionButton, ActionDialog, AppBreadcrumb, AppLayout, CardSkeleton, ClusterStatusIndicator, ContainerLogsPanel, CreateClusterDialog, CreateDatabaseDialog, CreateServerDialog, CreateTeamDialog, DataTable, DatabaseTerminal, DeleteDialog, DeploymentTargets, FormField, FormSection, Icon, InviteMemberDialog, JsonEditor, LogsPanel, MetricsChart, MetricChartQuery, MonospaceCard, NotificationDropdown, QueryResultTable, QueryHistory, RowPage, SearchInput, SecretEditor, SectionCard, SectionHeader, ServerStatusBadge, ServerFormFields, ServerResources, ServerTags, ServerVolumes, ServerDatabases, ServerTerminal, ServerMaintenance, Sidebar, StatusBadge, TableSkeleton, TabsList, TeamDropdown, Terminal, ThemeToggle, UpdateTeamDialog, WebhookListener

### Critical Issues

| #   | Issue                      | Severity   | Details                                          |
| --- | -------------------------- | ---------- | ------------------------------------------------ |
| 1   | TanStack Router v0 (beta)  | **HIGH**   | Unstable API, breaking changes in v1             |
| 2   | Vite instead of Next.js    | **HIGH**   | No SSR, no API routes, no file-based routing     |
| 3   | No Radix UI adoption       | **MEDIUM** | Mixing component patterns, inconsistent behavior |
| 4   | Inconsistent form patterns | **MEDIUM** | Some forms uncontrolled, mixing approaches       |
| 5   | No error boundaries        | **MEDIUM** | Crashes can take down entire app                 |
| 6   | No loading skeletons       | **LOW**    | Perceived performance could be improved          |

### Recommendations

- **Migrate to Next.js 15 App Router** (Priority: P0, 8-10 weeks)
  - File-based routing replaces route definitions
  - API routes for serverless functions
  - SSR/SSG for improved performance
  - Built-in image optimization
- **Upgrade TanStack Router to v1** (Priority: P1, 2-3 weeks)
  - Stabilize routing API
  - Use new search params API
  - Implement proper type-safe routing
- **Standardize on Radix UI + shadcn/ui** (Priority: P1, 4-6 weeks)
  - Replace all custom form components
  - Consistent dialog/alert patterns
  - Accessible by default
- **Add Error Boundaries** (Priority: P1, 1 week)
  - Per-route error boundaries
  - Fallback UI components
  - Error reporting integration

## 2.3 Backend API

### API Structure

The API follows RESTful conventions with these characteristics:

| Aspect          | Status                                       |
| --------------- | -------------------------------------------- |
| Base path       | /api/v1/                                     |
| Content type    | JSON                                         |
| Authentication  | Cookie (session) or Bearer (API token)       |
| Response format | JSON with consistent envelope                |
| Error format    | { "error": "message", "code": "ERROR_CODE" } |
| Pagination      | Cursor-based for large collections           |
| WebSockets      | For terminal and real-time logs              |
| SSE             | For build logs and mesh events               |

### Endpoint Categories

| Category      | Count    | Description                                               |
| ------------- | -------- | --------------------------------------------------------- |
| Auth          | 7        | Login, logout, signup, password reset, email verification |
| Teams         | 14       | CRUD, members, invites, tokens, audit logs                |
| Servers       | 16       | CRUD, tags, provisioning, terminal, logs                  |
| Clusters      | 12       | CRUD, members, mesh, events                               |
| Projects      | 6        | CRUD, environments                                        |
| Apps          | 28       | CRUD, builds, deployments, scaling, traffic, logs         |
| Databases     | 24       | CRUD, backups, restore, linking, rotation, query          |
| Volumes       | 10       | CRUD, attach, detach, snapshots                           |
| Secrets       | 5        | CRUD, reveal                                              |
| SSH Keys      | 4        | CRUD                                                      |
| Registries    | 6        | CRUD, validate                                            |
| GitHub        | 7        | App setup, installations, repos                           |
| Observability | 11       | Metrics, alerts, channels, silences                       |
| Templates     | 3        | List, get, versions                                       |
| Storage       | 1        | Status                                                    |
| Discovery     | 1        | Discovery endpoint                                        |
| **Total**     | **~155** |                                                           |

### API Issues

| #   | Issue                                     | Severity     | Recommendation                  |
| --- | ----------------------------------------- | ------------ | ------------------------------- |
| 1   | No OpenAPI/Swagger documentation          | HIGH         | Generate OpenAPI spec from code |
| 2   | No API versioning strategy beyond v1      | MEDIUM       | Plan v2 evolution strategy      |
| 3   | No request/response validation middleware | MEDIUM       | Add structured validation       |
| 4   | Inconsistent error response formats       | MEDIUM       | Standardize error envelope      |
| 5   | No API rate limiting                      | **CRITICAL** | Implement immediately           |

### Code Quality Assessment

**Strengths:** - Clean separation between handlers and services - Proper context propagation - Structured logging - Request ID middleware for tracing - CORS configuration - Recovery middleware for panic handling

**Weaknesses:** - Some handlers are too large (violation of single responsibility) - Missing input validation on some endpoints - Inconsistent error handling patterns

## 2.4 Database & Storage

### Database Schema Overview

PostgreSQL serves as the primary data store with 60+ tables organized into these domains:

| Domain         | Tables                                                          | Purpose                  |
| -------------- | --------------------------------------------------------------- | ------------------------ |
| Identity       | users, teams, team_memberships, team_invites                    | Authentication & RBAC    |
| Infrastructure | servers, server_tags, clusters, cluster_members                 | Hardware & networking    |
| Projects       | projects, environments, apps                                    | Application organization |
| Deployments    | builds, deployments, deployment_targets, traffic_routes         | CI/CD                    |
| Databases      | databases, database_backups, database_links, database_rotations | Managed DBs              |
| Storage        | volumes, volume_snapshots, registry_credentials, secrets        | Persistence              |
| GitHub         | github_apps, github_installations, github_webhook_events        | Integration              |
| Observability  | metric_samples, alert_rules, alert_events, alert_silences       | Monitoring               |

### Key Tables

**apps Table (Core Application Data):**

id, project_id, name, slug, source_type, github_installation_id,  
repo_full_name, branch, root_path, auto_deploy, builder, dockerfile_path,  
port, health_check_path, replicas, placement_strategy, status,  
resource_cpu_millicores, resource_memory_mb, metadata(jsonb),  
custom_domain, created_at, updated_at

**servers Table (Infrastructure):**

id, team_id, agent_id, name, hostname, public_ip, ssh_port, ssh_user,  
os, os_version, arch, status, metadata(jsonb), last_seen_at,  
created_at, updated_at

**deployments Table (Deployment Records):**

id, app_id, environment_id, build_id, strategy, replicas_desired,  
replicas_ready, env_snapshot, status, started_at, completed_at,  
error, logs, platform_domain, created_at

### Strengths

| Feature               | Assessment                               |
| --------------------- | ---------------------------------------- |
| Migration system      | golang-migrate with versioned migrations |
| Foreign keys          | Proper referential integrity             |
| JSONB for flexibility | Good use for metadata/config             |
| Audit fields          | created_at/updated_at on all tables      |
| Soft deletes          | Appropriate use patterns                 |
| Indexes               | Proper indexing on query columns         |

### Issues

| #   | Issue                                 | Severity | Recommendation               |
| --- | ------------------------------------- | -------- | ---------------------------- |
| 1   | No database connection pooling config | MEDIUM   | Add pgbouncer or pool config |
| 2   | No read replica support               | MEDIUM   | Plan for read replicas       |
| 3   | No point-in-time recovery             | HIGH     | Implement WAL archiving      |
| 4   | No automated backup verification      | MEDIUM   | Add backup integrity checks  |
| 5   | JSONB columns lack validation         | LOW      | Add JSON schema validation   |

## 2.5 Deployment Pipeline

### Current Flow

Git Push / Manual Trigger  
|  
v  
Create Build Record (status: pending)  
|  
v  
Builder Agent picks up build  
|  
v  
Clone Repository → Build Image → Push to Registry  
|  
v  
Build Complete (status: built)  
|  
v  
Auto-Trigger Deployment (if auto_deploy enabled)  
|  
v  
Create Deployment Record (status: pending)  
|  
v  
Schedule Targets (based on placement strategy)  
|  
v  
Pull Image → Start Container → Health Check  
|  
v  
Deployment Healthy

### Build System

| Feature                    | Status      | Details                      |
| -------------------------- | ----------- | ---------------------------- |
| GitHub webhook integration | Implemented | HMAC signature verification  |
| Manual build trigger       | Implemented | API endpoint + UI button     |
| Build caching              | Partial     | Layer caching via Docker     |
| Multi-builder support      | Implemented | Nixpacks, Docker, Buildpacks |
| Build logs streaming       | Implemented | SSE-based real-time logs     |
| Build artifacts            | Implemented | Image pushed to registry     |

### Deployment System

| Feature               | Status      | Details                               |
| --------------------- | ----------- | ------------------------------------- |
| Rolling deployments   | Implemented | Zero-downtime rolling updates         |
| Placement strategies  | Implemented | Spread, binpack, pinned               |
| Health checks         | Basic       | Configurable path only                |
| Environment variables | Implemented | Encrypted secrets injection           |
| Traffic routing       | Implemented | Weighted backends via Traefik         |
| Rollback              | Partial     | Basic rollback to previous deployment |

### Critical Gaps

| Feature                    | Priority | Effort    |
| -------------------------- | -------- | --------- |
| Preview environments       | P0       | 3-4 weeks |
| Pipeline stages with gates | P0       | 4-6 weeks |
| Blue-green deployments     | P1       | 3-4 weeks |
| Canary deployments         | P1       | 4-5 weeks |
| Health check customization | P0       | 2-3 weeks |
| Release management         | P1       | 2-3 weeks |

## 2.6 Scheduling & Placement

### Current Implementation

The scheduler determines where to deploy application containers based on:

| Strategy | Description                                | Use Case          |
| -------- | ------------------------------------------ | ----------------- |
| Spread   | Distribute evenly across available servers | High availability |
| Binpack  | Fill servers to capacity before moving     | Cost optimization |
| Pinned   | Deploy to specific server                  | Data locality     |

### Placement Constraints

Server tags are used for placement constraints:

must_have: { env: production, region: us-east }  
must_not_have: { role: database }

### Issues

| #   | Issue                                  | Severity | Details                                         |
| --- | -------------------------------------- | -------- | ----------------------------------------------- |
| 1   | No resource-aware scheduling           | HIGH     | Doesn't consider actual CPU/memory availability |
| 2   | No anti-affinity rules                 | MEDIUM   | Can't prevent co-location of related services   |
| 3   | No node affinity                       | MEDIUM   | Can't prefer specific server types              |
| 4   | Scheduling happens at deploy time only | LOW      | No rebalancing of running workloads             |
| 5   | No resource quotas per team            | HIGH     | No limit on resource consumption                |

### Recommendations

- Add resource-aware scheduling (consider actual CPU/memory/disk)
- Implement anti-affinity and affinity rules
- Add per-team resource quotas
- Consider periodic rebalancing for spread strategy

## 2.7 Auto-Scaling

### Current Implementation Analysis

**Architecture:**

Autoscaler Loop (service.go:126)  
|  
+-- 30s fixed ticker (HARDCODED)  
|  
+-- Sequential app evaluation  
|  
+-- GetAverageMetricsForApp (WRONG: server-level averages)  
|  
+-- For each rule: compare threshold  
|  
+-- If triggered: ScaleApp (FULL REDEPLOY: 30-120s)

### 11 Critical Problems

| #   | Problem                                | Location              | Impact                        |
| --- | -------------------------------------- | --------------------- | ----------------------------- |
| 1   | 30-second fixed evaluation loop        | service.go:127        | One-size-fits-all apps        |
| 2   | Only 2 metrics supported               | service.go:878        | Limited scaling triggers      |
| 3   | duration_seconds stored but never used | autoscaling.sql:18    | Spikes trigger false scales   |
| 4   | Server-level metrics for app decisions | server_metrics.sql:10 | Completely wrong metrics      |
| 5   | Full deployment on every scale         | service.go:852        | 30-120s vs <5s needed         |
| 6   | No scale-to-zero                       | service.go:366        | Can't optimize idle workloads |
| 7   | No predictive scaling                  | N/A                   | No proactive scaling          |
| 8   | No scheduled scaling                   | N/A                   | Can't pre-scale for events    |
| 9   | No stabilization windows               | N/A                   | Flapping (rapid up/down)      |
| 10  | Synchronous sequential evaluation      | N/A                   | Thundering herd risk          |
| 11  | Single condition per rule              | N/A                   | No complex rule logic         |

### Database Schema

autoscaling_rules:  
id, app_id, name, metric_name, comparison, threshold,  
duration_seconds (NOT USED), action_type, action_value,  
min_replicas, max_replicas, cooldown_up_seconds,  
cooldown_down_seconds, enabled, last_triggered_at  
<br/>scaling_events:  
id, app_id, environment_id, deployment_id, actor_id, actor_type,  
event_type, from_replicas, to_replicas, placement_strategy,  
metric_name, metric_value, rule_name, message, metadata

### New Architecture Summary

The redesigned auto-scaling engine addresses all 11 problems:

| Problem             | Current               | New Design                      |
| ------------------- | --------------------- | ------------------------------- |
| Evaluation interval | Hardcoded 30s         | Per-app configurable (5s-1h)    |
| Metrics             | 2 (server-level)      | 15+ container-level + custom    |
| Duration tracking   | Stored, never used    | Proper threshold breach windows |
| Scale speed         | Full deploy (30-120s) | Fast replica adjustment (<5s)   |
| Scale-to-zero       | Not supported         | Full support with cold start    |
| Rule logic          | Single condition      | Multi-condition AND/OR          |

See **Part 4** for complete redesign specification.

## 2.8 Observability

### Current Implementation

**Metrics Pipeline:**

Node Exporter / cAdvisor → VictoriaMetrics ← PromQL Queries  
|  
Nixway API Server  
|  
UI Charts

**Metrics Collection:** | Source | Metrics | Interval | |---|---|----| | node_exporter | Server CPU, memory, disk, network | 15s | | cAdvisor | Container CPU, memory, network | 15s | | Custom | App-specific metrics | Configurable |

**Alerting:** | Feature | Status | |---|---| | Alert rule creation | Implemented | | Metric threshold alerts | Implemented | | Alert evaluation | Implemented | | Notification channels | Partial (email) | | Alert silencing | Implemented | | Alert history | Implemented |

### Issues

| #   | Issue                         | Severity | Details                               |
| --- | ----------------------------- | -------- | ------------------------------------- |
| 1   | No distributed tracing        | HIGH     | No OpenTelemetry integration          |
| 2   | Log search is basic           | HIGH     | No full-text search backend           |
| 3   | No APM                        | MEDIUM   | No application performance monitoring |
| 4   | Limited notification channels | MEDIUM   | Only email, no Slack/PagerDuty        |
| 5   | No custom dashboards          | LOW      | Only pre-built metric views           |
| 6   | No log-based alerting         | MEDIUM   | Can't alert on log patterns           |

### Recommendations

- Integrate Grafana Loki for log aggregation (Priority: P0)
- Add OpenTelemetry for distributed tracing (Priority: P1)
- Expand notification channels (Slack, PagerDuty) (Priority: P1)
- Add APM with request tracing (Priority: P1)

## 2.9 Cluster & Mesh Networking

### Current Implementation

**WireGuard Mesh Architecture:**

Cluster (CIDR: 10.x.x.x/24)  
|  
+-- Server 1 (WireGuard IP: 10.x.x.1)  
| +-- Peer config for Server 2, 3  
|  
+-- Server 2 (WireGuard IP: 10.x.x.2)  
| +-- Peer config for Server 1, 3  
|  
+-- Server 3 (WireGuard IP: 10.x.x.3)  
+-- Peer config for Server 1, 2

**Features:** | Feature | Status | Details | |---|---|---| | Cluster creation | Implemented | Auto-allocated CIDR | | Member management | Implemented | Add/remove servers | | WireGuard key generation | Implemented | Per-member keys | | Mesh configuration push | Implemented | Agent-side config | | DNS resolution | Implemented | CoreDNS with cluster zone | | Health monitoring | Implemented | RTT-based health matrix | | Mesh regeneration | Implemented | Key rotation on demand | | Mesh event streaming | Implemented | SSE-based event stream |

### DNS Architecture

{cluster-slug}.internal  
|  
+-- {server-name}.{cluster-slug}.internal → WireGuard IP  
+-- {app-name}.{cluster-slug}.internal → Container IP

### Strengths

| Feature                  | Competitive Advantage                     |
| ------------------------ | ----------------------------------------- |
| Full mesh topology       | Every server can reach every other server |
| Automatic key management | No manual WireGuard configuration         |
| DNS integration          | Service discovery via DNS                 |
| Health visualization     | Real-time mesh health matrix              |

### Issues

| #   | Issue                           | Severity | Details                         |
| --- | ------------------------------- | -------- | ------------------------------- |
| 1   | No mesh topology alternatives   | LOW      | Only full mesh, no hub-spoke    |
| 2   | No bandwidth limits             | LOW      | No QoS on mesh links            |
| 3   | Mesh regeneration is disruptive | MEDIUM   | Brief connectivity interruption |

## 2.10 Managed Database Service

### Supported Databases

| Database   | Status           | Versions   | Features               |
| ---------- | ---------------- | ---------- | ---------------------- |
| PostgreSQL | Production-ready | 14, 15, 16 | Full feature set       |
| MySQL      | Production-ready | 8.0        | Full feature set       |
| MongoDB    | Production-ready | 6.0, 7.0   | Basic operations       |
| Redis      | Production-ready | 7.x        | Key operations, config |
| MariaDB    | Available        | 10.x, 11.x | MySQL-compatible       |

### Features

| Feature             | Status      | Details                               |
| ------------------- | ----------- | ------------------------------------- |
| Provisioning        | Implemented | Template-based with SSE progress      |
| Credential rotation | Implemented | With linked app auto-restart          |
| Automated backups   | Implemented | S3/MinIO storage                      |
| Backup restore      | Implemented | Point-in-time from backup             |
| Database linking    | Implemented | Auto env var injection                |
| Browser/query tool  | Implemented | Table browser + SQL query runner      |
| Terminal access     | Implemented | Database CLI via WebSocket            |
| Redis inspector     | Implemented | Key browsing, config, info            |
| MongoDB inspector   | Partial     | Collection browsing, document viewing |

### Unique Strengths (Competitive)

- **Credential rotation with auto-restart** - Linked apps automatically redeploy
- **Database browser** - Web-based table browsing and SQL execution
- **One-time credential reveal** - Secure initial credential display
- **Query history** - Track all executed queries
- **Saved queries** - Reusable query templates

### Issues

| #   | Issue                         | Severity | Details                       |
| --- | ----------------------------- | -------- | ----------------------------- |
| 1   | No read replicas              | HIGH     | Read scaling not available    |
| 2   | No point-in-time recovery     | HIGH     | Can only restore from backups |
| 3   | No connection pooling         | MEDIUM   | Apps connect directly         |
| 4   | No query performance insights | MEDIUM   | No slow query log integration |
| 5   | Backup verification missing   | MEDIUM   | No integrity checks           |

## 2.11 Security

### Current Security Measures

| Layer          | Implementation                    | Assessment |
| -------------- | --------------------------------- | ---------- |
| Authentication | bcrypt passwords, secure sessions | Good       |
| Authorization  | RBAC with role hierarchy          | Good       |
| API Tokens     | SHA-256 hashed, scoped            | Good       |
| Secrets        | AES-GCM encryption                | Good       |
| SSH Keys       | Encrypted private key storage     | Good       |
| Audit Logging  | Comprehensive operation log       | Excellent  |
| Network        | WireGuard mesh encryption         | Good       |
| Container      | Docker isolation                  | Standard   |

### Security Issues

| #   | Issue                            | Severity     | Recommendation                 |
| --- | -------------------------------- | ------------ | ------------------------------ |
| 1   | No 2FA/MFA                       | HIGH         | Implement TOTP                 |
| 2   | No API rate limiting             | **CRITICAL** | Add Redis-backed rate limiting |
| 3   | No resource quotas               | HIGH         | Implement per-team limits      |
| 4   | No DDoS protection               | MEDIUM       | Add IP-based rate limiting     |
| 5   | No WAF                           | LOW          | Consider ModSecurity           |
| 6   | No SSL certificate management    | HIGH         | Custom cert upload, monitoring |
| 7   | No security scanning             | MEDIUM       | Container image scanning       |
| 8   | No penetration testing framework | LOW          | Regular security audits        |

### Security Recommendations Priority

| Priority | Action                     | Effort    |
| -------- | -------------------------- | --------- |
| P0       | API rate limiting          | 1-2 weeks |
| P0       | Resource quotas            | 3-4 weeks |
| P1       | 2FA/MFA                    | 3-4 weeks |
| P1       | SSL certificate management | 1-2 weeks |
| P2       | Container image scanning   | 2-3 weeks |

## 2.12 Infrastructure

### Deployment Architecture

Load Balancer (Traefik)  
|  
+-- API Server (Go Echo)  
| +-- PostgreSQL  
| +-- Redis  
| +-- RabbitMQ  
|  
+-- Job Runner (Go)  
|  
+-- VictoriaMetrics (TSDB)  
|  
+-- CoreDNS

### Infrastructure Components

| Component       | Purpose                           | Status      |
| --------------- | --------------------------------- | ----------- |
| Traefik         | Reverse proxy, load balancer, SSL | Operational |
| PostgreSQL      | Primary database                  | Operational |
| Redis           | Cache, pub/sub, session store     | Operational |
| RabbitMQ        | Message queue for async jobs      | Operational |
| VictoriaMetrics | Time-series metrics database      | Operational |
| CoreDNS         | Internal DNS service              | Operational |
| Docker          | Container runtime                 | Operational |

### Infrastructure Gaps

| Feature                    | Priority | Effort     | Details                    |
| -------------------------- | -------- | ---------- | -------------------------- |
| Multi-region support       | P2       | 8-10 weeks | Geo-distributed deployment |
| CDN integration            | P1       | 2-3 weeks  | Static asset caching       |
| IPv6 support               | P2       | 3-4 weeks  | Dual-stack networking      |
| Disaster recovery          | P1       | 4-6 weeks  | Cross-region failover      |
| Automated backups (config) | P1       | 2-3 weeks  | Platform config backup     |

# Part 3: Frontend Migration Plan

## 3.1 Vite → Next.js 15 Migration

### Why Next.js 15

| Feature                 | Vite (Current) | Next.js 15    | Benefit                       |
| ----------------------- | -------------- | ------------- | ----------------------------- |
| SSR/SSG                 | Manual setup   | Built-in      | SEO, initial load performance |
| File-based routing      | Manual         | App Router    | Simpler route management      |
| API routes              | None           | Built-in      | Serverless API endpoints      |
| Image optimization      | Manual         | next/image    | Automatic optimization        |
| Font optimization       | Manual         | next/font     | Automatic optimization        |
| Code splitting          | Manual         | Automatic     | Better performance            |
| Streaming               | None           | Streaming SSR | Progressive rendering         |
| React Server Components | No             | Yes           | Reduced client JS             |

### Migration Phases

#### Phase 1: Preparation (Weeks 1-2)

**Tasks:** - \[ \] Set up Next.js 15 project structure alongside existing Vite app - \[ \] Configure TypeScript, Tailwind CSS v4, and shadcn/ui - \[ \] Set up environment configuration - \[ \] Create shared component library - \[ \] Set up CI/CD for new build process

**File Structure:**

frontend-v2/  
├── app/ # Next.js App Router  
│ ├── (auth)/ # Auth route group  
│ │ ├── login/  
│ │ ├── signup/  
│ │ ├── forgot-password/  
│ │ └── reset-password/  
│ ├── (dashboard)/ # Dashboard route group  
│ │ ├── dashboard/  
│ │ ├── servers/  
│ │ ├── clusters/  
│ │ ├── projects/  
│ │ ├── databases/  
│ │ ├── volumes/  
│ │ ├── ssh-keys/  
│ │ └── settings/  
│ ├── api/ # API routes  
│ ├── layout.tsx # Root layout  
│ └── globals.css # Global styles  
├── components/  
│ ├── ui/ # shadcn/ui components  
│ ├── layout/ # Layout components  
│ ├── forms/ # Form components  
│ └── data-display/ # Table, chart components  
├── lib/  
│ ├── api.ts # API client  
│ ├── auth.ts # Auth utilities  
│ └── utils.ts # General utilities  
├── hooks/ # Custom React hooks  
├── types/ # TypeScript types  
└── public/ # Static assets

#### Phase 2: Foundation (Weeks 3-4)

**Tasks:** - \[ \] Migrate authentication pages (login, signup, password reset) - \[ \] Implement layout shell (sidebar, topbar) - \[ \] Set up TanStack Query v5 with proper hydration - \[ \] Migrate theme system (dark/light mode) - \[ \] Implement error boundaries - \[ \] Set up loading skeletons

**Key Decisions:** - Use **Next.js App Router** (not Pages Router) - Server Components by default, Client Components for interactivity - Keep TanStack Query for client-side data fetching - Use next/navigation for programmatic navigation

#### Phase 3: Page Migration (Weeks 5-8)

**Migration Order:**

| Priority | Page                      | Complexity | Effort |
| -------- | ------------------------- | ---------- | ------ |
| 1        | Dashboard                 | Medium     | 3 days |
| 2        | Servers (list + detail)   | High       | 5 days |
| 3        | Projects (list + detail)  | High       | 5 days |
| 4        | Clusters (list + detail)  | High       | 5 days |
| 5        | Databases (list + detail) | High       | 5 days |
| 6        | Settings                  | Medium     | 3 days |
| 7        | SSH Keys                  | Low        | 2 days |
| 8        | Volumes                   | Medium     | 3 days |
| 9        | Teams                     | Low        | 2 days |

**For each page:** 1. Create route directory in App Router 2. Migrate route component to page.tsx 3. Extract data fetching to server components where possible 4. Migrate child components to new component structure 5. Update API calls to use proper patterns 6. Add loading.tsx for suspense boundaries 7. Add error.tsx for error boundaries

#### Phase 4: Feature Parity (Weeks 9-10)

**Tasks:** - \[ \] Migrate terminal components (xterm.js integration) - \[ \] Migrate real-time features (SSE, WebSockets) - \[ \] Ensure all CRUD operations work - \[ \] Verify all API integrations - \[ \] Test responsive design - \[ \] Performance optimization

### Critical Changes

| Pattern      | Vite (Current)                | Next.js 15                       |
| ------------ | ----------------------------- | -------------------------------- |
| Router       | &lt;Router&gt;, &lt;Route&gt; | File-based app/ directory        |
| Navigation   | useNavigate()                 | useRouter(), redirect()          |
| Params       | Route.useParams()             | useParams() from next/navigation |
| Search       | Route.useSearch()             | useSearchParams()                |
| Data loading | Manual useEffect              | Server Components + fetch        |
| Meta tags    | react-helmet                  | Metadata API                     |
| Images       | &lt;img&gt;                   | &lt;Image&gt; from next/image    |
| Fonts        | @font-face                    | next/font                        |

## 3.2 Radix UI Component System

### Current State

The frontend currently uses: - shadcn/ui components (built on Radix UI) - Custom components with mixed patterns - Some components using native HTML elements

### Target State

All components should use: - **Radix UI primitives** for accessibility and behavior - **shadcn/ui styling** with Tailwind CSS - **Consistent API patterns** across all components

### Component Migration Plan

| Component Category | Current  | Target                       | Effort    |
| ------------------ | -------- | ---------------------------- | --------- |
| Forms              | Mixed    | Radix Form + shadcn/ui       | 1 week    |
| Dialogs            | Custom   | Radix Dialog + shadcn        | 3 days    |
| Dropdowns          | Custom   | Radix DropdownMenu           | 2 days    |
| Tabs               | Custom   | Radix Tabs + shadcn          | 2 days    |
| Tables             | Custom   | shadcn/ui Table              | 2 days    |
| Charts             | Recharts | Keep Recharts + shadcn theme | 2 days    |
| Terminal           | xterm.js | Keep xterm.js                | No change |

### New Components to Build

| Component     | Purpose                     | Based On                  |
| ------------- | --------------------------- | ------------------------- |
| StatusBadge   | Resource status indicators  | Badge + custom colors     |
| ResourceMeter | CPU/Memory/Disk gauges      | Progress + custom styling |
| MetricChart   | Time-series charts          | Recharts + custom theme   |
| LogViewer     | Log streaming display       | Custom + xterm.js         |
| TerminalPanel | Shell terminal              | xterm.js + WebSocket      |
| DataTable     | Sortable, filterable tables | shadcn Table + TanStack   |
| FormWizard    | Multi-step forms            | Custom + Radix primitives |
| CodeBlock     | Syntax-highlighted code     | Custom + Prism            |
| CopyButton    | Copy-to-clipboard button    | Button + Clipboard API    |
| ConfirmDialog | Confirmation dialogs        | AlertDialog + custom      |

### shadcn/ui Theme Configuration

// components.json  
{  
"\$schema": "<https://ui.shadcn.com/schema.json>",  
"style": "default",  
"rsc": true,  
"tsx": true,  
"tailwind": {  
"config": "tailwind.config.ts",  
"css": "app/globals.css",  
"baseColor": "neutral",  
"cssVariables": true,  
},  
"aliases": {  
"components": "@/components",  
"utils": "@/lib/utils",  
"ui": "@/components/ui",  
"lib": "@/lib",  
"hooks": "@/hooks"  
}  
}

### Color System (OKLCH-based)

| Token              | Light Mode                | Dark Mode                 | Usage           |
| ------------------ | ------------------------- | ------------------------- | --------------- |
| \--background      | oklch(1 0 0)              | oklch(0.145 0 0)          | Page background |
| \--foreground      | oklch(0.145 0 0)          | oklch(0.985 0 0)          | Primary text    |
| \--primary         | oklch(0.205 0 0)          | oklch(0.985 0 0)          | Primary actions |
| \--destructive     | oklch(0.577 0.245 27.325) | oklch(0.396 0.141 25.723) | Errors          |
| \--status-online   | #22c55e                   | #22c55e                   | Healthy/online  |
| \--status-degraded | #eab308                   | #eab308                   | Warning         |
| \--status-offline  | #ef4444                   | #ef4444                   | Error/offline   |

## 3.3 Complete Page Inventory

### Public Pages (No Authentication)

| Route                     | Page Component     | Purpose                   |
| ------------------------- | ------------------ | ------------------------- |
| /signup                   | SignupPage         | User registration         |
| /login                    | LoginPage          | User login                |
| /forgot-password          | ForgotPasswordPage | Password recovery request |
| /reset-password/\[token\] | ResetPasswordPage  | Password reset execution  |
| /verify-email/\[token\]   | VerifyEmailPage    | Email verification        |
| /github/callback          | GitHubCallbackPage | GitHub App OAuth callback |

### Protected Pages (Authentication Required)

#### Dashboard

| Route      | Component     | Description                  |
| ---------- | ------------- | ---------------------------- |
| /dashboard | DashboardPage | Team dashboard with overview |

#### Infrastructure

| Route                                     | Component          | Description              |
| ----------------------------------------- | ------------------ | ------------------------ |
| /servers/\[teamId\]                       | ServersPage        | Server list with status  |
| /servers/\[teamId\]/\[serverId\]          | ServerDetailPage   | Server detail with tabs  |
| /servers/\[teamId\]/\[serverId\]/terminal | ServerTerminalPage | WebSocket terminal       |
| /clusters/\[teamId\]                      | ClustersPage       | Cluster list             |
| /clusters/\[teamId\]/\[clusterId\]        | ClusterDetailPage  | Cluster detail with mesh |

#### Projects & Apps

| Route                              | Component         | Description          |
| ---------------------------------- | ----------------- | -------------------- |
| /projects/\[teamId\]               | ProjectsPage      | Project list         |
| /projects/\[teamId\]/\[projectId\] | ProjectDetailPage | Project with apps    |
| /apps/\[appId\]                    | AppDetailPage     | App detail with tabs |
| /apps/\[appId\]/logs               | AppLogsPage       | Container logs       |
| /apps/\[appId\]/terminal           | AppTerminalPage   | Container terminal   |
| /apps/\[appId\]/metrics            | AppMetricsPage    | Application metrics  |

#### Databases

| Route                               | Component            | Description          |
| ----------------------------------- | -------------------- | -------------------- |
| /databases/\[teamId\]               | DatabasesPage        | Database list        |
| /databases/\[teamId\]/\[projectId\] | ProjectDatabasesPage | Project databases    |
| /databases/\[databaseId\]           | DatabaseDetailPage   | DB detail with tools |
| /databases/\[databaseId\]/terminal  | DatabaseTerminalPage | DB CLI terminal      |
| /databases/\[databaseId\]/query     | DatabaseQueryPage    | SQL query runner     |
| /databases/\[databaseId\]/tables    | DatabaseTablesPage   | Table browser        |

#### Storage

| Route                            | Component        | Description   |
| -------------------------------- | ---------------- | ------------- |
| /volumes/\[teamId\]              | VolumesPage      | Volume list   |
| /volumes/\[teamId\]/\[volumeId\] | VolumeDetailPage | Volume detail |

#### Security

| Route                | Component   | Description        |
| -------------------- | ----------- | ------------------ |
| /ssh-keys/\[teamId\] | SSHKeysPage | SSH key management |

#### Settings

| Route                         | Component           | Description             |
| ----------------------------- | ------------------- | ----------------------- |
| /settings/\[teamId\]          | SettingsPage        | Team settings with tabs |
| /settings/\[teamId\]/general  | GeneralSettingsTab  | General configuration   |
| /settings/\[teamId\]/github   | GitHubSettingsTab   | GitHub integration      |
| /settings/\[teamId\]/registry | RegistrySettingsTab | Registry credentials    |
| /settings/\[teamId\]/secrets  | SecretsSettingsTab  | Secret management       |

#### Teams

| Route                       | Component       | Description          |
| --------------------------- | --------------- | -------------------- |
| /teams                      | TeamsPage       | Team list            |
| /teams/\[teamId\]           | TeamDetailPage  | Team detail          |
| /teams/\[teamId\]/members   | TeamMembersTab  | Member management    |
| /teams/\[teamId\]/tokens    | TeamTokensTab   | API token management |
| /teams/\[teamId\]/audit-log | TeamAuditLogTab | Audit log viewer     |

### Component Architecture

Layout Hierarchy:  
<br/>RootLayout (Next.js)  
|  
+-- Providers (TanStack Query, Theme, Auth)  
|  
+-- ShellLayout (sidebar + topbar + content)  
|  
+-- Page Content  
|  
+-- Server Components (data fetching)  
|  
+-- Client Components (interactivity)  
|  
+-- UI Components (shadcn/ui)

## 3.4 UI/UX Design System

### Typography

| Token      | Size             | Weight | Usage             |
| ---------- | ---------------- | ------ | ----------------- |
| display-xl | 48px / 3rem      | 700    | Hero sections     |
| display-lg | 36px / 2.25rem   | 700    | Page titles       |
| heading-lg | 24px / 1.5rem    | 600    | Card titles       |
| heading-md | 20px / 1.25rem   | 600    | Subsections       |
| body-lg    | 16px / 1rem      | 400    | Large body text   |
| body-md    | 14px / 0.875rem  | 400    | Default body text |
| body-sm    | 13px / 0.8125rem | 400    | Dense content     |
| body-xs    | 12px / 0.75rem   | 400    | Captions, labels  |
| mono-md    | 13px / 0.8125rem | 400    | Code, metrics     |

### Font Families

\--font-sans: 'Geist', 'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif;  
\--font-mono: 'Geist Mono', 'JetBrains Mono', ui-monospace, monospace;

### Spacing System (4px base)

| Token       | Value | Usage           |
| ----------- | ----- | --------------- |
| \--space-1  | 4px   | Tight padding   |
| \--space-2  | 8px   | Small gaps      |
| \--space-3  | 12px  | Component gap   |
| \--space-4  | 16px  | Default padding |
| \--space-6  | 24px  | Section gaps    |
| \--space-8  | 32px  | Large gaps      |
| \--space-12 | 48px  | Page padding    |
| \--space-16 | 64px  | Major sections  |

### Breakpoints

| Name | Min Width | Target         |
| ---- | --------- | -------------- |
| xs   | 0px       | Small phones   |
| sm   | 480px     | Large phones   |
| md   | 640px     | Small tablets  |
| lg   | 768px     | Tablets        |
| xl   | 1024px    | Small desktops |
| 2xl  | 1280px    | Desktops       |
| 3xl  | 1536px    | Large monitors |

### Animation Tokens

| Token               | Duration | Usage               |
| ------------------- | -------- | ------------------- |
| \--duration-instant | 50ms     | Micro-interactions  |
| \--duration-fast    | 150ms    | Hover, focus        |
| \--duration-normal  | 200ms    | Dropdowns, tooltips |
| \--duration-slow    | 300ms    | Sidebar, dialogs    |
| \--duration-slower  | 500ms    | Page transitions    |

### Accessibility Requirements

- All interactive elements: minimum 44x44px touch targets
- Color contrast: 4.5:1 for normal text, 3:1 for large text
- Focus visible on all interactive elements
- Keyboard navigation support (Tab, Enter, Escape, arrow keys)
- Screen reader support with proper ARIA attributes
- prefers-reduced-motion support

## 3.5 Migration Timeline & Phases

### Complete Migration Timeline

Week 1-2: \[ Preparation \]  
\- Next.js 15 project setup  
\- shadcn/ui + Tailwind v4 configuration  
\- CI/CD pipeline setup  
<br/>Week 3-4: \[ Foundation \]  
\- Auth pages migration  
\- Layout shell (sidebar + topbar)  
\- TanStack Query integration  
\- Error boundaries + loading states  
<br/>Week 5-6: \[ Core Pages - Infrastructure \]  
\- Dashboard page  
\- Servers (list + detail + terminal)  
\- Clusters (list + detail + mesh)  
<br/>Week 7-8: \[ Core Pages - Applications \]  
\- Projects (list + detail)  
\- Apps (detail + logs + terminal + metrics)  
\- Databases (list + detail + tools)  
<br/>Week 9: \[ Supporting Pages \]  
\- Volumes, SSH Keys, Settings  
\- Teams (detail + members + tokens + audit)  
<br/>Week 10: \[ Polish & Performance \]  
\- Feature parity verification  
\- Performance optimization  
\- Responsive design testing  
\- Accessibility audit

### Resource Requirements

| Role                     | Count | Duration      |
| ------------------------ | ----- | ------------- |
| Senior Frontend Engineer | 2     | Full 10 weeks |
| UI/UX Designer           | 1     | Weeks 1-4, 10 |
| QA Engineer              | 1     | Weeks 7-10    |

### Risk Assessment

| Risk                                     | Likelihood | Impact | Mitigation                   |
| ---------------------------------------- | ---------- | ------ | ---------------------------- |
| TanStack Router v0 → v1 breaking changes | High       | High   | Maintain compatibility layer |
| Next.js App Router learning curve        | Medium     | Medium | Training + documentation     |
| Performance regression                   | Medium     | High   | Benchmark before/after       |
| Feature parity gaps                      | Low        | Medium | Comprehensive test suite     |

# Part 4: Auto-Scaling Engine Redesign

## 4.1 Current Problems (Detailed)

### Problem 1: 30-Second Fixed Evaluation Loop

**Current Code (service.go:127):**

ticker := time.NewTicker(30 \* time.Second) // HARDCODED

**Impact:** All applications are evaluated at the same fixed interval, regardless of their scaling sensitivity needs. High-traffic e-commerce apps and low-traffic internal tools are treated identically.

### Problem 2: Only 2 Metrics Supported

**Current Code (service.go:878-887):**

func metricValue(name string, metrics db.GetAverageMetricsForAppRow) (float64, bool) {  
switch name {  
case "cpu_percent":  
return metrics.CpuPercent, true  
case "memory_percent":  
return metrics.MemoryPercent, true  
default:  
return 0, false  
}  
}

**Impact:** The metricValue() function is a hardcoded switch statement. No extensibility for custom metrics. The VictoriaMetrics pipeline already collects 15+ container metrics that are unusable for autoscaling.

### Problem 3: duration_seconds Stored but NEVER Used

**Current Code (autoscaling.sql:18):**

duration_seconds INT NOT NULL DEFAULT 120,

**Impact:** The field is stored in the database and returned in API responses but completely ignored in EvaluateAutoscaling(). A 1-second spike can trigger a scale action.

### Problem 4: Server-Level Metrics Drive App-Level Decisions

**Current Code (server_metrics.sql:10-26):**

SELECT COALESCE(AVG(sm.cpu_percent), 0)  
FROM deployments d  
JOIN deployment_targets dt ON dt.deployment_id = d.id  
JOIN server_metrics sm ON sm.server_id = dt.server_id  
WHERE d.app_id = \$1

**Impact:** This query averages server-level CPU/memory across all servers that happen to run the app's containers. If Server A runs App 1 at 90% CPU and Server B runs App 2 at 10% CPU, App 1 sees 50% CPU - completely wrong.

### Problem 5: Full Deployment on Every Scale

**Current Code (service.go:852-862):**

scale, err := s.ScaleApp(ctx, appID, ScaleRequest{...})  
// ScaleApp → UpdateAppScaling → TriggerDeploy → FULL REDEPLOY (30-120s)

**Impact:** Every scale action creates a new deployment record, rebuilds env snapshots, re-schedules targets, and dispatches deploy commands to agents. For a simple "add 1 replica" this takes 30-120 seconds instead of <5 seconds.

### Problem 6: No Scale-to-Zero

**Current Code (service.go:366):**

if req.Replicas <= 0 {  
return ScaleResult{}, fmt.Errorf("replicas must be greater than zero")  
}

**Impact:** Applications cannot scale to zero, preventing cost optimization for idle workloads.

### Problems 7-11: Missing Advanced Features

| #   | Problem                           | Impact                              |
| --- | --------------------------------- | ----------------------------------- |
| 7   | No predictive scaling             | No proactive capacity management    |
| 8   | No scheduled scaling              | Can't pre-scale before known events |
| 9   | No stabilization windows          | Flapping (rapid scale up/down)      |
| 10  | No per-app evaluation intervals   | One-size-fits-all approach          |
| 11  | Synchronous sequential evaluation | Thundering herd risk                |

## 4.2 New Architecture

### Component Diagram

+================================================================+  
| NIXWAY CORE AUTO-SCALING ENGINE v2 |  
+================================================================+  
<br/>Metrics Sources:  
+------------------+ +------------------+ +------------------+  
| VictoriaMetrics | | Custom Metrics | | Schedule Store |  
| (PromQL) | | (User API) | | (Cron Rules) |  
+--------+---------+ +--------+---------+ +--------+---------+  
| | |  
+-----------+---------+ |  
| |  
+-----------v-----------+ +--------v---------+  
| METRICS PIPELINE | | SCHEDULER |  
| | | (cron runner) |  
| + Metric Provider | +--------+---------+  
| + Container Aggregator | |  
| + App-Level Aggregator | |  
| (avg, p50, p95, p99, max) +--------v---------+  
+-----------+-----------+ |  
| |  
+-----------v---------------------------------v---------+  
| EVALUATION ENGINE |  
| |  
| + Rule Engine (AND/OR logic, rule groups) |  
| + Worker Pool (parallel eval) |  
| + Duration Tracker (state machine) |  
| + Cooldown Manager |  
+-----------+----------------------------------------------+  
|  
+-----------v-----------+  
| DECISION ENGINE |  
| |  
| + Conflict Resolution |  
| + Scale Bounds Enforcement |  
| + Gradual Scale Limiter |  
| + Emergency Bypass |  
+-----------+-----------+  
|  
+-----------v-----------+  
| ACTION EXECUTOR |  
| |  
| + Fast Scale (replica adj) |  
| + Safe Scale (health check) |  
| + Rollback on Failure |  
| + Rate Limiter |  
+-----------+-----------+  
|  
+-----------v-----------+  
| EVENT STORE |  
| (scaling_events) |  
+-----------------------+

### Component Responsibilities

| Component                | Responsibility                                                                | Package                                  |
| ------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------- |
| **Metrics Pipeline**     | Collect and aggregate container-level metrics from VictoriaMetrics via PromQL | internal/autoscale/metrics/              |
| **Metric Provider**      | Pluggable interface for metric sources (PromQL, DB, custom API)               | internal/autoscale/metrics/provider.go   |
| **Container Aggregator** | Aggregate raw container metrics (avg, p50, p95, p99, max) per app             | internal/autoscale/metrics/aggregator.go |
| **Evaluation Engine**    | Configurable async rule evaluation with worker pool                           | internal/autoscale/engine/               |
| **Rule Engine**          | Parse and evaluate multi-condition rules with AND/OR logic                    | internal/autoscale/engine/rules.go       |
| **Duration Tracker**     | State machine for threshold breach duration tracking                          | internal/autoscale/engine/duration.go    |
| **Decision Engine**      | Conflict resolution, bounds enforcement, gradual scaling                      | internal/autoscale/decision/             |
| **Action Executor**      | Fast scaling without redeploy, safe scaling, rollback                         | internal/autoscale/executor/             |
| **Schedule Store**       | Cron-based scheduled scaling rules                                            | internal/autoscale/schedule/             |

### Key Improvements

| Problem             | Current                                        | New Design                                      |
| ------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Evaluation interval | Hardcoded 30s                                  | Per-app configurable (5s-1h)                    |
| Supported metrics   | 2 (cpu_percent, memory_percent - server-level) | 15+ built-in + custom metrics (container-level) |
| Duration tracking   | Stored but never used                          | Proper threshold breach window tracking         |
| Metric granularity  | Server-level averages                          | Container-level aggregated to app-level         |
| Scale speed         | Full deployment (30-120s)                      | Fast replica adjustment (<5s)                   |
| Scale-to-zero       | Not supported                                  | Full scale-to/from-zero with cold start         |
| Predictive scaling  | None                                           | ML-based time-series forecasting                |
| Scheduled scaling   | None                                           | Cron-based scheduled scaling rules              |
| Stabilization       | None                                           | Configurable up/down stabilization windows      |
| Evaluation model    | Sequential sync                                | Async parallel with worker pool                 |
| Rule logic          | Single condition per rule                      | Multi-condition AND/OR with rule groups         |

### New Package Structure

internal/autoscale/  
├── engine/ # Evaluation Engine  
│ ├── engine.go # Main evaluation orchestrator  
│ ├── worker.go # Worker pool for parallel evaluation  
│ ├── rules.go # Rule parsing & multi-condition logic  
│ ├── duration.go # Duration breach tracking state machine  
│ ├── cooldown.go # Cooldown management  
│ └── strategies.go # Strategy interface & implementations  
├── metrics/ # Metrics Pipeline  
│ ├── provider.go # MetricProvider interface  
│ ├── promql.go # VictoriaMetrics PromQL provider  
│ ├── custom.go # Custom metric provider  
│ ├── aggregator.go # Container-to-app aggregation  
│ └── freshness.go # Metric staleness handling  
├── decision/ # Decision Engine  
│ ├── decision.go # Decision orchestrator  
│ ├── conflict.go # Conflict resolution  
│ ├── bounds.go # Scale bounds enforcement  
│ ├── gradual.go # Gradual scaling limiter  
│ └── emergency.go # Emergency scale bypass  
├── executor/ # Action Executor  
│ ├── executor.go # Action orchestrator  
│ ├── fast_scale.go # Fast replica adjustment  
│ ├── safe_scale.go # Safe scale with health checks  
│ ├── rollback.go # Rollback on failure  
│ └── rate_limiter.go # Action rate limiting  
├── schedule/ # Scheduled Scaling  
│ ├── scheduler.go # Cron-based scheduler  
│ ├── parser.go # Cron expression parser  
│ └── timezone.go # Timezone handling  
├── prediction/ # Predictive Scaling (Phase 4)  
│ ├── forecaster.go # Time-series forecasting interface  
│ ├── prometheus.go # Historical metrics fetcher  
│ └── model.go # ML model wrapper  
├── cache/ # State Cache  
│ └── cache.go # Redis-backed state cache  
├── config.go # Configuration types  
├── types.go # Shared types & interfaces  
├── service.go # Main service facade  
└── loop.go # Autoscaler loops (per-app, global)

### Container-Level Metrics

**Built-in Container Metrics (from VictoriaMetrics):**

| Metric Name                 | PromQL Query                                   | Scale Direction  |
| --------------------------- | ---------------------------------------------- | ---------------- |
| container.cpu_percent       | nixway_container_cpu_percent                   | up/down          |
| container.memory_percent    | nixway_container_memory_percent                | up/down          |
| container.memory_used_bytes | nixway_container_memory_used_bytes             | up               |
| container.network_rx_bytes  | rate(nixway_container_network_rx_bytes\[1m\])  | up               |
| container.network_tx_bytes  | rate(nixway_container_network_tx_bytes\[1m\])  | up               |
| container.block_read_bytes  | rate(nixway_container_block_read_bytes\[1m\])  | up               |
| container.block_write_bytes | rate(nixway_container_block_write_bytes\[1m\]) | up               |
| container.restart_count     | nixway_container_restart_count                 | up (unhealthy)   |
| container.uptime_seconds    | nixway_container_uptime_seconds                | down (stability) |

**App-Level Aggregated Metrics:**

| Metric Name                   | Aggregation                                    | Description                       |
| ----------------------------- | ---------------------------------------------- | --------------------------------- |
| app.container_cpu_percent.avg | avg()                                          | Average CPU across all containers |
| app.container_cpu_percent.p95 | histogram_quantile(0.95)                       | 95th percentile CPU               |
| app.container_cpu_percent.max | max()                                          | Maximum CPU (hot container)       |
| app.request_rate              | rate(http_requests_total\[1m\])                | HTTP requests per second          |
| app.request_latency.p95       | histogram_quantile(0.95)                       | 95th percentile latency           |
| app.error_rate                | rate(http_requests_total{status=~"5.."}\[1m\]) | Error rate                        |
| app.active_connections        | active_connections gauge                       | Active connections                |

### Per-App Evaluation Configuration

// PerAppAutoscaleConfig stored in apps.autoscale_config JSONB  
type PerAppAutoscaleConfig struct {  
EvaluationIntervalSeconds int32 \`json:"evaluation_interval_seconds"\`  
Enabled bool \`json:"enabled"\`  
ScaleToZero bool \`json:"scale_to_zero"\`  
StabilizationUpSeconds int32 \`json:"stabilization_up_seconds"\`  
StabilizationDownSeconds int32 \`json:"stabilization_down_seconds"\`  
MaxReplicasPerMinute int32 \`json:"max_replicas_per_minute"\`  
MetricsSource string \`json:"metrics_source"\` // "promql", "db", "hybrid"  
}

### New Database Schema

\-- Updated apps table with autoscale config  
ALTER TABLE apps ADD COLUMN IF NOT EXISTS autoscale_config JSONB DEFAULT '{  
"evaluation_interval_seconds": 30,  
"enabled": false,  
"scale_to_zero": false,  
"stabilization_up_seconds": 0,  
"stabilization_down_seconds": 300,  
"max_replicas_per_minute": 10,  
"metrics_source": "promql"  
}';  
<br/>\-- Enhanced autoscaling_rules with multi-condition support  
ALTER TABLE autoscaling_rules ADD COLUMN IF NOT EXISTS rule_group VARCHAR(50);  
ALTER TABLE autoscaling_rules ADD COLUMN IF NOT EXISTS logical_operator VARCHAR(10) DEFAULT 'AND';  
ALTER TABLE autoscaling_rules ADD COLUMN IF NOT EXISTS priority INT DEFAULT 100;  
ALTER TABLE autoscaling_rules ADD COLUMN IF NOT EXISTS scale_step INT DEFAULT 1;  
ALTER TABLE autoscaling_rules ADD COLUMN IF NOT EXISTS metric_aggregation VARCHAR(10) DEFAULT 'avg';

## 4.3 Implementation Phases

### Phase 1: Metrics Pipeline (Week 1-2)

| Task                      | Effort | Details                                 |
| ------------------------- | ------ | --------------------------------------- |
| MetricProvider interface  | 2 days | Pluggable metric source abstraction     |
| PromQL provider           | 2 days | VictoriaMetrics container-level queries |
| Container Aggregator      | 2 days | Aggregate per-container to app-level    |
| Metric freshness handling | 1 day  | Staleness detection and rejection       |
| Cache layer               | 1 day  | Redis-backed metric caching             |

### Phase 2: Evaluation Engine (Week 3-4)

| Task                     | Effort | Details                            |
| ------------------------ | ------ | ---------------------------------- |
| Worker pool              | 2 days | Async parallel evaluation          |
| Rule engine (AND/OR)     | 2 days | Multi-condition rule parsing       |
| Duration tracker         | 2 days | State machine for breach tracking  |
| Cooldown management      | 1 day  | Per-direction cooldown enforcement |
| Per-app evaluation loops | 1 day  | Configurable intervals per app     |

### Phase 3: Decision Engine (Week 5)

| Task                     | Effort | Details                               |
| ------------------------ | ------ | ------------------------------------- |
| Conflict resolution      | 2 days | Priority-based decision merging       |
| Scale bounds enforcement | 1 day  | Min/max replica limits                |
| Gradual scaling limiter  | 1 day  | Max replicas per evaluation           |
| Emergency bypass         | 1 day  | Skip cooldown for critical thresholds |

### Phase 4: Action Executor (Week 6)

| Task                          | Effort | Details                                    |
| ----------------------------- | ------ | ------------------------------------------ |
| Fast scale path               | 2 days | Direct replica adjustment without redeploy |
| Safe scale with health checks | 2 days | Verify health after scale                  |
| Rollback on failure           | 1 day  | Revert to previous replica count           |
| Rate limiter                  | 1 day  | Prevent excessive scale actions            |

### Phase 5: Scheduled Scaling (Week 7)

| Task              | Effort | Details                       |
| ----------------- | ------ | ----------------------------- |
| Cron scheduler    | 2 days | Cron expression evaluation    |
| Schedule store    | 2 days | Database schema and CRUD      |
| Timezone handling | 1 day  | Per-schedule timezone support |

### Phase 6: Integration & Testing (Week 8)

| Task                 | Effort | Details                               |
| -------------------- | ------ | ------------------------------------- |
| Service facade       | 2 days | Unified service interface             |
| API endpoints update | 2 days | Update existing autoscaling endpoints |
| Integration tests    | 3 days | End-to-end scaling scenarios          |
| Load testing         | 1 day  | Validate under high load              |

### Total Effort: 8 weeks

### Resource Requirements

| Role               | Count | Duration     |
| ------------------ | ----- | ------------ |
| Senior Go Engineer | 2     | Full 8 weeks |
| Platform Engineer  | 1     | Weeks 5-8    |
| QA Engineer        | 1     | Weeks 7-8    |

# Part 5: User Workflows

## 5.1 Complete Workflow Catalog (32 Workflows)

### A. Account & Access (6 Workflows)

#### A1: User Registration

| Step | Actor  | Action                                          | System/UI                    |
| ---- | ------ | ----------------------------------------------- | ---------------------------- |
| 1    | User   | Navigates to signup page                        | /signup route                |
| 2    | User   | Enters full name, email, password (min 8 chars) | &lt;Input&gt; fields         |
| 3    | User   | Clicks "Create account"                         | &lt;Button type="submit"&gt; |
| 4    | System | Validates input, calls POST /api/v1/auth/signup | API request                  |
| 5    | System | Creates user, generates verification token      | INSERT INTO users            |
| 6    | System | Sends verification email                        | Email service                |
| 7    | System | Displays success view                           | Card: "Check your email"     |

**Edge Cases:** | Scenario | Handling | |----|----| | Email already registered | 409 Conflict: "Email already in use" | | Password < 8 characters | Client-side validation blocks submission | | Email service failure | User created; verification can be resent |

#### A2: Password Recovery

| Step | Actor  | Action                                  | System/UI               |
| ---- | ------ | --------------------------------------- | ----------------------- |
| 1    | User   | Clicks "Forgot password?"               | &lt;Link&gt;            |
| 2    | User   | Enters registered email                 | &lt;Input&gt;           |
| 3    | System | Calls POST /api/v1/auth/forgot-password | API request             |
| 4    | System | Generates reset token with expiry       | Token generation        |
| 5    | System | Sends reset email                       | Email service           |
| 6    | User   | Clicks reset link                       | /reset-password/\$token |
| 7    | User   | Enters new password                     | &lt;Input&gt;           |
| 8    | System | Validates token, updates password       | Database update         |

#### A3: Team Creation & Onboarding

| Step | Actor  | Action                            | System/UI                    |
| ---- | ------ | --------------------------------- | ---------------------------- |
| 1    | User   | Navigates to Teams page           | &lt;Link to="/teams"&gt;     |
| 2    | User   | Clicks "Create Team"              | &lt;DialogTrigger&gt;        |
| 3    | User   | Enters team name                  | &lt;Input id="team-name"&gt; |
| 4    | User   | Clicks "Create"                   | &lt;Button&gt;               |
| 5    | System | Calls POST /api/v1/teams          | API request                  |
| 6    | System | Auto-generates slug, creates team | Transaction                  |
| 7    | System | Adds creator as owner             | TeamMembership insert        |
| 8    | System | Closes dialog, refreshes list     | Query invalidation           |

#### A4: Team Invitation & Role Assignment

| Step | Actor   | Action                                | System/UI                   |
| ---- | ------- | ------------------------------------- | --------------------------- |
| 1    | User    | Navigates to team settings            | /teams/\$teamId/settings    |
| 2    | User    | Enters invitee email                  | &lt;Input type="email"&gt;  |
| 3    | User    | Selects role (Member/Admin)           | &lt;Select&gt;              |
| 4    | User    | Clicks "Send Invite"                  | &lt;Button&gt;              |
| 5    | System  | Generates invite token (7-day expiry) | TeamInvite insert           |
| 6    | System  | Sends invitation email                | Email service               |
| 7    | Invitee | Clicks invite link                    | POST /api/v1/invites/accept |
| 8    | System  | Creates TeamMembership                | Database insert             |

**Role Hierarchy:** Owner (3) > Admin (2) > Member (1)

#### A5: API Token Generation & Scoping

| Step | Actor  | Action                                | System/UI              |
| ---- | ------ | ------------------------------------- | ---------------------- |
| 1    | User   | Navigates to team detail > API Tokens | /teams/\$teamId/tokens |
| 2    | User   | Clicks "Create Token"                 | &lt;DialogTrigger&gt;  |
| 3    | User   | Enters token name                     | &lt;Input&gt;          |
| 4    | User   | Selects scopes                        | Checkbox grid          |
| 5    | System | Generates secure token, stores hash   | SHA-256                |
| 6    | System | Returns plain token once              | Success dialog         |
| 7    | User   | Copies token to clipboard             | Copy button            |

**Available Scopes:** teams:\*, members:\*, servers:\*, tokens:\*, audit:\*, invites:\*, \*

#### A6: CLI Authentication

| Step | Actor  | Action                            |
| ---- | ------ | --------------------------------- |
| 1    | User   | Runs nixway login                 |
| 2    | System | Prompts for API token             |
| 3    | User   | Enters token                      |
| 4    | System | Validates via GET /api/v1/auth/me |
| 5    | System | Stores in ~/.nixway/config        |
| 6    | System | Prompts for team selection        |
| 7    | User   | Selects active team               |

### B. Infrastructure (5 Workflows)

#### B1: Server Registration

| Step | Actor  | Action                                                    | System/UI          |
| ---- | ------ | --------------------------------------------------------- | ------------------ |
| 1    | User   | Navigates to Servers page                                 | /servers/\$teamId  |
| 2    | User   | Clicks "Add Server"                                       | Dialog opens       |
| 3    | User   | Enters name, hostname, IP, SSH port (22), SSH user (root) | Form fields        |
| 4    | User   | Clicks "Next"                                             | Advances to Step 2 |
| 5    | User   | Selects SSH key from dropdown                             | &lt;Select&gt;     |
| 6    | User   | Clicks "Add Server"                                       | Submit             |
| 7    | System | Calls POST /api/v1/teams/{id}/servers                     | API request        |
| 8    | System | Stores server with status = "offline"                     | Database insert    |
| 9    | System | Initiates background agent connection                     | Agent connection   |

**Server Model:**

ID, TeamID, AgentID, Name, Hostname, PublicIp, SshPort, SshUser,  
OS, OSVersion, Arch, Status (online|offline|degraded|provisioning),  
LastSeenAt, CreatedAt, UpdatedAt

#### B2: Server Decommissioning

| Step | Actor  | Action                                       | System/UI                            |
| ---- | ------ | -------------------------------------------- | ------------------------------------ |
| 1    | User   | Navigates to server detail                   | Server row click                     |
| 2    | User   | Clicks "Delete Server"                       | &lt;Button variant="destructive"&gt; |
| 3    | System | Confirmation dialog                          | "Are you sure?"                      |
| 4    | User   | Confirms                                     | Click "Delete"                       |
| 5    | System | Calls DELETE /api/v1/teams/{id}/servers/{id} | API request                          |
| 6    | System | Removes from cluster (if member)             | Cluster cleanup                      |
| 7    | System | Deletes server record                        | Database delete                      |
| 8    | System | Redirects to servers list                    | Navigation                           |

#### B3: Cluster Creation

| Step | Actor  | Action                                 | System/UI           |
| ---- | ------ | -------------------------------------- | ------------------- |
| 1    | User   | Navigates to Clusters page             | /clusters/\$teamId  |
| 2    | User   | Clicks "Create Cluster"                | Dialog opens        |
| 3    | User   | Enters name, description, region       | Form fields         |
| 4    | User   | Clicks "Create"                        | Submit              |
| 5    | System | Calls POST /api/v1/teams/{id}/clusters | API request         |
| 6    | System | Auto-allocates private CIDR block      | Backend allocation  |
| 7    | System | Creates cluster with status = "active" | Database insert     |
| 8    | User   | Clicks cluster row                     | Navigate to detail  |
| 9    | User   | Switches to "Members" tab              | &lt;TabsTrigger&gt; |
| 10   | User   | Clicks "Add Server", selects server    | Dialog + Select     |
| 11   | System | Assigns WireGuard IP, generates keys   | IP allocation       |
| 12   | System | Pushes mesh config to agent            | Agent command       |

**Cluster Model:**

ID, TeamID, Name, Slug, Description, Region, Cidr,  
Status (active|degraded|error), CreatedAt, UpdatedAt

#### B4: Mesh Network Management

**Health Monitoring:**

| Step | Actor  | Action                                 | System/UI                                   |
| ---- | ------ | -------------------------------------- | ------------------------------------------- |
| 1    | User   | Navigates to cluster detail > Mesh tab | &lt;TabsTrigger value="mesh"&gt;            |
| 2    | System | Displays mesh health matrix            | MeshHealthMatrix component                  |
| 3    | System | Shows connectivity stats               | "X/Y links active, Z%"                      |
| 4    | System | Color-coded matrix based on RTT        | Green &lt;10ms, Yellow <50ms, Red &gt;200ms |
| 5    | System | Auto-refreshes every 15 seconds        | refetchInterval: 15_000                     |

**Mesh Regeneration:**

| Step | Actor  | Action                          | System/UI      |
| ---- | ------ | ------------------------------- | -------------- |
| 6    | User   | Clicks "Regenerate Mesh"        | &lt;Button&gt; |
| 7    | System | Calls POST /mesh/regenerate     | API request    |
| 8    | System | Regenerates all WireGuard keys  | Key rotation   |
| 9    | System | Pushes new config to all agents | Agent commands |

**Mesh Events:** - member_added, member_removed, mesh_regenerated - link_failure, link_restored - Color-coded: green (success), yellow (warning), red (error)

#### B5: Server Tagging & Organization

| Step | Actor  | Action                                          | System/UI            |
| ---- | ------ | ----------------------------------------------- | -------------------- |
| 1    | User   | Navigates to server detail > Tags tab           | &lt;TabsTrigger&gt;  |
| 2    | System | Displays current tags table                     | Key, Value, Actions  |
| 3    | User   | Enters key and value                            | &lt;Input&gt; fields |
| 4    | User   | Clicks "+" button                               | Submit               |
| 5    | System | Calls POST /api/v1/teams/{id}/servers/{id}/tags | API request          |
| 6    | System | Tag appears in table                            | UI update            |

**Tag Usage for Placement:** - must_have: { env: production, region: us-east } - must_not_have: { role: database } - Format: key=value,key2=value2

### C. Application Lifecycle (10 Workflows)

#### C1: Project Creation

| Step | Actor  | Action                                     | System/UI          |
| ---- | ------ | ------------------------------------------ | ------------------ |
| 1    | User   | Navigates to Projects page                 | /projects/\$teamId |
| 2    | User   | Clicks "New Project"                       | Dialog opens       |
| 3    | User   | Enters name, description                   | Form fields        |
| 4    | User   | Selects target cluster                     | &lt;Select&gt;     |
| 5    | User   | Clicks "Create"                            | Submit             |
| 6    | System | Calls POST /api/v1/teams/{teamId}/projects | API request        |
| 7    | System | Auto-generates slug                        | Backend slugify    |
| 8    | System | Creates project                            | Database insert    |

#### C2: GitHub-Connected App Setup

**Phase 1: GitHub App Setup (One-time)**

| Step | Actor  | Action                             | System/UI                    |
| ---- | ------ | ---------------------------------- | ---------------------------- |
| 1    | User   | Navigates to Settings > GitHub tab | &lt;Tabs&gt;                 |
| 2    | User   | Clicks "Connect GitHub App"        | &lt;Button&gt;               |
| 3    | System | Creates manifest, POSTs to GitHub  | github.com/settings/apps/new |
| 4    | User   | Completes GitHub App creation      | GitHub UI                    |
| 5    | GitHub | Redirects back with code           | /github/callback             |
| 6    | System | Exchanges code, stores credentials | Database insert              |

**Phase 2: Create GitHub-Connected App**

| Step | Actor  | Action                                | System/UI                     |
| ---- | ------ | ------------------------------------- | ----------------------------- |
| 7    | User   | Navigates to project detail           | Project page                  |
| 8    | User   | Clicks "New App"                      | Dialog opens                  |
| 9    | User   | Enters app name                       | &lt;Input&gt;                 |
| 10   | User   | Selects source "GitHub Repository"    | &lt;Select value="github"&gt; |
| 11   | User   | Selects GitHub account                | Installations dropdown        |
| 12   | User   | Searches and selects repository       | RepoSearchSelect              |
| 13   | User   | Selects registry, builder, sets port  | Form fields                   |
| 14   | User   | Clicks "Create App"                   | Submit                        |
| 15   | System | Calls POST /api/v1/projects/{id}/apps | API request                   |

#### C3: Docker Image App Setup

| Step | Actor  | Action                                | System/UI                                |
| ---- | ------ | ------------------------------------- | ---------------------------------------- |
| 1    | User   | Navigates to project detail           | Project page                             |
| 2    | User   | Clicks "New App"                      | Dialog opens                             |
| 3    | User   | Enters app name                       | &lt;Input&gt;                            |
| 4    | User   | Selects source "Docker Image"         | &lt;Select value="docker_image"&gt;      |
| 5    | User   | Enters Docker image reference         | &lt;Input placeholder="nginx:latest"&gt; |
| 6    | User   | Sets port and health check path       | Form fields                              |
| 7    | User   | Clicks "Create App"                   | Submit                                   |
| 8    | System | Calls POST /api/v1/projects/{id}/apps | API request                              |

#### C4: Environment Variable Management

**View/Filter Secrets:**

| Step | Actor  | Action                                             | System/UI                          |
| ---- | ------ | -------------------------------------------------- | ---------------------------------- |
| 1    | User   | Navigates to Settings > Secrets tab                | &lt;Tabs&gt;                       |
| 2    | System | Shows secrets list with environment filter         | Select: production/staging/preview |
| 3    | User   | Selects environment                                | &lt;Select&gt;                     |
| 4    | System | Calls GET /api/v1/teams/{id}/secrets?environment=X | API request                        |
| 5    | System | Displays secrets: Key, Version, Revealed status    | Table                              |

**Add Secret:**

| Step | Actor  | Action                                    | System/UI          |
| ---- | ------ | ----------------------------------------- | ------------------ |
| 6    | User   | Clicks "Add Secret"                       | Dialog opens       |
| 7    | User   | Selects environment, enters key and value | Form fields        |
| 8    | System | Calls POST /api/v1/teams/{id}/secrets     | API request        |
| 9    | System | Encrypts value with master key (AES-GCM)  | Encryption service |
| 10   | System | Stores with version = 1                   | Database insert    |

**Reveal Secret:**

| Step | Actor  | Action                          | System/UI                     |
| ---- | ------ | ------------------------------- | ----------------------------- |
| 11   | User   | Clicks eye icon                 | &lt;Button title="Reveal"&gt; |
| 12   | System | Calls POST /secrets/{id}/reveal | API request                   |
| 13   | System | Decrypts and returns value      | Decryption service            |
| 14   | System | Records revealed_at timestamp   | Audit log                     |

#### C5: Build Trigger (Manual/Webhook/CI-CD)

**Manual Build:**

| Step | Actor  | Action                                 | System/UI                          |
| ---- | ------ | -------------------------------------- | ---------------------------------- |
| 1    | User   | Navigates to app detail > Builds tab   | &lt;TabsTrigger value="builds"&gt; |
| 2    | User   | Clicks "Trigger Build"                 | &lt;Button&gt;                     |
| 3    | System | Calls POST /api/v1/apps/{appId}/builds | API request                        |
| 4    | System | Creates build with status = "pending"  | Database insert                    |
| 5    | System | Builder agent picks up build           | Queue processing                   |

**GitHub Webhook Build:**

| Step | Actor     | Action                             |
| ---- | --------- | ---------------------------------- |
| 1    | Developer | Pushes commit to configured branch |
| 2    | GitHub    | Sends push webhook to Nixway       |
| 3    | Nixway    | Validates HMAC signature           |
| 4    | Nixway    | Triggers build for matching app    |

**Build Status Flow:**

pending → cloning → building → built (success)  
| | |  
v v v  
failed failed failed

#### C6: Build Monitoring

| Step | Actor  | Action                               | System/UI                              |
| ---- | ------ | ------------------------------------ | -------------------------------------- |
| 1    | User   | Views Builds tab                     | Auto-refreshes every 15s               |
| 2    | System | Shows build table with status badges | Green=built, Blue=building, Red=failed |
| 3    | User   | Clicks on build row                  | &lt;Dialog&gt; with max-width 3xl      |
| 4    | System | Opens SSE connection for build logs  | EventSource                            |
| 5    | System | Displays streaming build logs        | Black terminal panel                   |
| 6    | System | Shows "Live" badge when connected    | Green badge                            |

#### C7: Deployment

| Step | Actor  | Action                                        | System/UI               |
| ---- | ------ | --------------------------------------------- | ----------------------- |
| 1    | User   | Navigates to app detail > Deployments tab     | &lt;TabsTrigger&gt;     |
| 2    | System | Shows deployment history                      | Table with status       |
| 3    | System | Auto-refreshes every 15 seconds               | refetchInterval: 15_000 |
| 4    | System | On successful build, auto-triggers deployment | Backend logic           |
| 5    | System | Creates deployment status = "pending"         | Database insert         |
| 6    | System | Selects target servers (placement strategy)   | Placement engine        |
| 7    | System | Pulls image, starts container, health check   | Agent commands          |
| 8    | System | Marks deployment healthy                      | Status update           |

**Deployment Status Flow:**

pending → deploying → healthy (all replicas ready)  
| |  
v v  
failed degraded (some replicas failed)

#### C8: Deployment Rollback

| Step | Actor  | Action                                                | System/UI                          |
| ---- | ------ | ----------------------------------------------------- | ---------------------------------- |
| 1    | User   | Navigates to app detail > Deployments tab             | Deployments table                  |
| 2    | System | Shows all deployments with rollback button            | Each row                           |
| 3    | User   | Finds previous healthy deployment                     | Green badge                        |
| 4    | User   | Clicks "Rollback" button                              | &lt;Button&gt; with RotateCcw icon |
| 5    | System | Confirmation dialog                                   | confirm('Rollback?')               |
| 6    | System | Calls POST /api/v1/apps/{appId}/rollback              | API request                        |
| 7    | System | Creates rollback build, stops current containers      | Agent commands                     |
| 8    | System | Restarts previous deployment containers               | Agent commands                     |
| 9    | System | Marks current as rolled_back, previous becomes active | Status updates                     |

#### C9: Custom Domain Setup

| Step | Actor  | Action                                        | System/UI                                   |
| ---- | ------ | --------------------------------------------- | ------------------------------------------- |
| 1    | User   | Navigates to app detail > Overview tab        | DomainsCard                                 |
| 2    | User   | Enters custom domain                          | &lt;Input placeholder="app.example.com"&gt; |
| 3    | User   | Clicks "Set"                                  | &lt;Button&gt;                              |
| 4    | System | Calls POST /api/v1/apps/{appId}/domain        | API request                                 |
| 5    | System | Shows "Unverified" badge                      | &lt;Badge variant="secondary"&gt;           |
| 6    | User   | Configures CNAME/A record at DNS provider     | External                                    |
| 7    | User   | Clicks "Verify DNS"                           | &lt;Button&gt;                              |
| 8    | System | Calls POST /api/v1/apps/{appId}/domain/verify | API request                                 |
| 9    | System | Resolves domain, checks IP                    | DNS lookup                                  |
| 10   | System | Shows "Verified" badge (green)                | &lt;Badge className="bg-green-500"&gt;      |

#### C10: Canary/Blue-Green Deployment (Traffic Splitting)

**View Traffic:**

| Step | Actor  | Action                                | System/UI                           |
| ---- | ------ | ------------------------------------- | ----------------------------------- |
| 1    | User   | Navigates to app detail > Traffic tab | &lt;TabsTrigger value="traffic"&gt; |
| 2    | System | Shows traffic route with backends     | Card with backends table            |
| 3    | System | Displays each backend with weight     | Table: Backend, Commit, Weight      |

**Traffic Splitting:**

| Step | Actor  | Action                                 | System/UI                  |
| ---- | ------ | -------------------------------------- | -------------------------- |
| 4    | User   | Clicks preset split buttons            | 100/0, 90/10, 50/50, 0/100 |
| 5    | System | Calls PUT /api/v1/apps/{appId}/traffic | API request                |
| 6    | System | Updates backend weights                | Database update            |
| 7    | System | Configures Traefik with new weights    | Agent push                 |

**Promote Backend:**

| Step | Actor  | Action                                    | System/UI      |
| ---- | ------ | ----------------------------------------- | -------------- |
| 8    | User   | Clicks "Promote" on desired backend       | &lt;Button&gt; |
| 9    | System | Calls POST /traffic/backends/{id}/promote | API request    |
| 10   | System | Sets promoted to 100%, others to 0%       | Weight update  |

### D. Database Management (6 Workflows)

#### D1: Database Provisioning

| Step | Actor  | Action                                               | System/UI       |
| ---- | ------ | ---------------------------------------------------- | --------------- |
| 1    | User   | Navigates to project > Databases                     | Link            |
| 2    | User   | Clicks "Provision Database"                          | Dialog opens    |
| 3    | User   | Selects template (PostgreSQL, MySQL, Redis, MongoDB) | &lt;select&gt;  |
| 4    | User   | Selects version                                      | &lt;select&gt;  |
| 5    | User   | Selects cluster, server (optional)                   | Dropdowns       |
| 6    | User   | Sets size (GB), CPU, memory, backup schedule         | Form fields     |
| 7    | User   | Clicks "Start Provisioning"                          | Submit          |
| 8    | System | Calls POST /api/v1/projects/{id}/databases           | API request     |
| 9    | System | Opens provision console with SSE stream              | Dialog switches |
| 10   | System | Streams provisioning events                          | SSE events      |
| 11   | System | Shows "Show credentials" button (on success)         | Enabled button  |
| 12   | User   | Clicks button, copies credentials                    | One-time reveal |

#### D2: Database Connection

| Step | Actor  | Action                                  | System/UI       |
| ---- | ------ | --------------------------------------- | --------------- |
| 1    | User   | Navigates to database detail > Overview | Database detail |
| 2    | System | Shows connection information            | Connection card |
| 3    | System | Displays masked connection string       | Template-based  |
| 4    | System | Shows container details                 | Container card  |

**Connection Strings:**

PostgreSQL: postgresql://{user}:{password}@{host}:{port}/{dbname}  
MySQL: mysql://{user}:{password}@{host}:{port}/{dbname}  
Redis: redis://:{password}@{host}:{port}  
MongoDB: mongodb://{user}:{password}@{host}:{port}/{dbname}

#### D3: Database Browser (Tables/Query)

**Table Browser:**

| Step | Actor  | Action                                    | System/UI         |
| ---- | ------ | ----------------------------------------- | ----------------- |
| 1    | User   | Navigates to database detail > Tables tab | &lt;button&gt;    |
| 2    | System | Lists schemas                             | GET /schemas      |
| 3    | User   | Selects schema, then table                | Interactive list  |
| 4    | System | Displays paginated rows                   | RowPage component |

**Query Runner:**

| Step | Actor  | Action                                       | System/UI         |
| ---- | ------ | -------------------------------------------- | ----------------- |
| 5    | User   | Switches to "Query" tab                      | &lt;button&gt;    |
| 6    | User   | Types SQL query                              | &lt;textarea&gt;  |
| 7    | User   | Clicks "Run"                                 | Execute button    |
| 8    | System | Calls POST /api/v1/databases/{id}/query      | API request       |
| 9    | System | Shows results: columns, rows, execution time | QueryResult       |
| 10   | System | Records query in history                     | QueryHistoryEntry |

#### D4: Backup Management

**Manual Backup:**

| Step | Actor  | Action                              | System/UI                 |
| ---- | ------ | ----------------------------------- | ------------------------- |
| 1    | User   | Navigates to database > Backups tab | &lt;button&gt;            |
| 2    | System | Shows backup list                   | Table: Type, Status, Size |
| 3    | User   | Clicks "Create Backup"              | &lt;Button&gt;            |
| 4    | System | Calls POST /databases/{id}/backups  | API request               |
| 5    | System | Executes backup using template tool | pg_dump, mysqldump        |
| 6    | System | Uploads to storage (S3/MinIO)       | Stream upload             |

**Restore:**

| Step | Actor  | Action                                  | System/UI          |
| ---- | ------ | --------------------------------------- | ------------------ |
| 7    | User   | Selects backup, clicks "Restore"        | Table row + Button |
| 8    | System | Calls POST /databases/{id}/restore      | API request        |
| 9    | System | Stops DB, downloads, restores, restarts | Agent commands     |
| 10   | System | Shows restore progress                  | SSE stream         |

#### D5: Credential Rotation

| Step | Actor  | Action                                  | System/UI                         |
| ---- | ------ | --------------------------------------- | --------------------------------- |
| 1    | User   | Navigates to database detail > Overview | Detail page                       |
| 2    | User   | Clicks "Rotate credentials"             | &lt;Button&gt; with KeyRound icon |
| 3    | System | Confirmation dialog                     | confirm()                         |
| 4    | System | Calls POST /databases/{id}/rotate       | API request                       |
| 5    | System | Generates new password, updates DB user | ALTER USER                        |
| 6    | System | Creates new secret version              | Secret update                     |
| 7    | System | Restarts linked apps                    | Auto-redeploy                     |
| 8    | System | Shows new password in modal             | One-time reveal                   |

#### D6: Database Linking

| Step | Actor  | Action                                  | System/UI       |
| ---- | ------ | --------------------------------------- | --------------- |
| 1    | User   | Navigates to database > Linked Apps tab | &lt;button&gt;  |
| 2    | System | Shows current links                     | Links table     |
| 3    | User   | Clicks "Link App"                       | &lt;Button&gt;  |
| 4    | User   | Selects app from project                | Dropdown        |
| 5    | User   | Sets env prefix (e.g., "DB\_")          | &lt;Input&gt;   |
| 6    | System | Calls POST /databases/{id}/links        | API request     |
| 7    | System | Injects env vars on next deploy         | Secret creation |

**Injected Environment Variables:**

{PREFIX}HOST = database DNS record  
{PREFIX}PORT = database port  
{PREFIX}USER = app username  
{PREFIX}PASSWORD = app password (secret reference)  
{PREFIX}NAME = database name  
{PREFIX}URL = full connection URL

### E. Operations (7 Workflows)

#### E1: Autoscaling Configuration

| Step | Actor  | Action                                            | System/UI                                 |
| ---- | ------ | ------------------------------------------------- | ----------------------------------------- |
| 1    | User   | Navigates to app detail > Scaling tab             | &lt;TabsTrigger value="scaling"&gt;       |
| 2    | System | Shows scaling configuration                       | Card layout                               |
| 3    | User   | Enters rule name                                  | &lt;Input&gt;                             |
| 4    | User   | Sets CPU threshold percentage                     | &lt;Input type="number"&gt; (default: 80) |
| 5    | User   | Sets max replicas                                 | &lt;Input type="number"&gt; (default: 10) |
| 6    | User   | Clicks "Add Rule"                                 | &lt;Button&gt;                            |
| 7    | System | Calls POST /api/v1/apps/{appId}/autoscaling-rules | API request                               |
| 8    | System | Creates rule with defaults                        | metric_name: "cpu_percent"                |

**Default Rule Parameters:**

metric_name: cpu_percent  
comparison: gt (>)  
threshold: 80%  
duration_seconds: 120  
action_type: scale_by  
action_value: +1 replica  
min_replicas: current replicas  
max_replicas: user-specified (default 10)  
cooldown_up: 60s  
cooldown_down: 300s  
enabled: true

#### E2: Autoscaling Event Response

| Step | Actor  | Action                                               | System/UI             |
| ---- | ------ | ---------------------------------------------------- | --------------------- |
| 1    | User   | Navigates to app detail > Scaling tab                | Scaling panel         |
| 2    | System | Shows scaling events history                         | Right-side card       |
| 3    | System | Displays recent events (last 6)                      | Border-left timeline  |
| 4    | User   | Clicks "Evaluate Now"                                | &lt;Button&gt;        |
| 5    | System | Calls POST /api/v1/apps/{appId}/autoscaling/evaluate | API request           |
| 6    | System | Shows evaluation results                             | Result cards per rule |
| 7    | System | Badge: green=ok, red=triggered                       | Status indicators     |

#### E3: Alert Rule Creation

| Step | Actor  | Action                                             | System/UI                    |
| ---- | ------ | -------------------------------------------------- | ---------------------------- |
| 1    | User   | Views observability panel                          | Any scope                    |
| 2    | System | Shows metric charts and alert section              | Card: "Alert Rules"          |
| 3    | User   | Enters alert name                                  | &lt;Input&gt;                |
| 4    | User   | Selects metric from dropdown                       | &lt;select&gt;               |
| 5    | User   | Selects comparison operator                        | &lt;select&gt;: >, >=, <, <= |
| 6    | User   | Enters threshold value                             | &lt;Input type="number"&gt;  |
| 7    | User   | Clicks "+" button                                  | &lt;Button&gt;               |
| 8    | System | Calls POST /api/v1/teams/{id}/observability/alerts | API request                  |

#### E4: Alert Response

**View Alert Events:**

| Step | Actor  | Action                                         | System/UI                   |
| ---- | ------ | ---------------------------------------------- | --------------------------- |
| 1    | User   | Views observability panel                      | Alert Events card           |
| 2    | System | Lists recent alert events                      | Table: State, Message, Time |
| 3    | System | States: firing (red), pending (gray), resolved | State badges                |

**Silence Alerts:**

| Step | Actor  | Action                                          |
| ---- | ------ | ----------------------------------------------- |
| 4    | User   | Creates silence rule via POST /silences         |
| 5    | System | Parameters: rule_id, scope, reason, start, end  |
| 6    | System | During silence, alerts don't send notifications |

#### E5: Log Streaming

**Real-time Container Logs:**

| Step | Actor  | Action                                         | System/UI                              |
| ---- | ------ | ---------------------------------------------- | -------------------------------------- |
| 1    | User   | Navigates to app detail > Logs tab             | &lt;TabsTrigger value="logs"&gt;       |
| 2    | System | Opens SSE connection                           | EventSource                            |
| 3    | System | Shows "Live" green badge                       | &lt;Badge className="bg-green-500"&gt; |
| 4    | System | Displays streaming logs                        | Black terminal panel                   |
| 5    | User   | Selects container from dropdown                | &lt;select&gt;                         |
| 6    | System | Shows historical tail (200 lines) then follows | ?tail=200&follow=true                  |

**Log Search:**

| Step | Actor  | Action                                     | System/UI                                  |
| ---- | ------ | ------------------------------------------ | ------------------------------------------ |
| 7    | User   | Enters search query                        | &lt;Input placeholder="Search logs..."&gt; |
| 8    | System | Calls GET /apps/{id}/logs/search?q={query} | API request                                |
| 9    | System | Displays matching entries                  | Timestamp + container + line               |

#### E6: Container Terminal (WebShell)

**Server Terminal:**

| Step | Actor  | Action                                         | System/UI                  |
| ---- | ------ | ---------------------------------------------- | -------------------------- |
| 1    | User   | Navigates to server detail > Terminal tab      | &lt;TabsTrigger&gt;        |
| 2    | System | Opens xterm.js terminal                        | &lt;Terminal&gt; component |
| 3    | System | Establishes WebSocket connection               | ws://.../terminal          |
| 4    | System | On connect: SSH session established            | Backend proxy              |
| 5    | User   | Types commands                                 | Keyboard input             |
| 6    | System | Input sent via WebSocket, output streamed back | Real-time                  |

**Container Terminal:**

| Step | Actor  | Action                               | System/UI         |
| ---- | ------ | ------------------------------------ | ----------------- |
| 7    | User   | Navigates to app detail              | App page          |
| 8    | System | Opens shell inside running container | docker exec       |
| 9    | User   | Runs diagnostic commands             | Interactive shell |

**Terminal Configuration:**

Font: JetBrains Mono, Menlo, Monaco, Consolas (14px)  
Theme: Tokyo Night inspired  
Background: #1a1b26, Foreground: #a9b1d6  
Height: 500px, Cursor blink: enabled

#### E7: Metrics Dashboard

| Step | Actor  | Action                               | System/UI                            |
| ---- | ------ | ------------------------------------ | ------------------------------------ |
| 1    | User   | Views observability panel            | Any scope                            |
| 2    | System | Shows metric charts in 2-column grid | &lt;MetricChartQuery&gt;             |
| 3    | User   | Selects time range                   | &lt;select&gt;: 5m, 1h, 24h, 7d, 30d |
| 4    | System | Fetches metric samples               | GET /observability/metrics           |
| 5    | System | Renders SVG sparkline charts         | Polyline + latest value              |
| 6    | System | Auto-refreshes every 15 seconds      | refetchInterval: 15_000              |

**Available Metrics by Scope:**

| Scope     | Metrics                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server    | server.cpu_percent, server.memory_percent, server.disk_percent, server.network_rx_bytes, server.network_tx_bytes, server.load1, server.file_descriptors |
| Cluster   | cluster.server_cpu_percent, cluster.server_memory_percent, cluster.container_cpu_percent, cluster.container_memory_percent                              |
| Project   | project.container_cpu_percent, project.container_memory_percent, project.container_network_rx_bytes, project.container_network_tx_bytes                 |
| App       | app.container_cpu_percent, app.container_memory_percent, app.container_network_rx_bytes, app.container_network_tx_bytes                                 |
| Container | container.cpu_percent, container.memory_percent, container.restart_count, container.uptime_seconds                                                      |

### F. Security & Compliance (4 Workflows)

#### F1: SSH Key Management

**Generate SSH Key:**

| Step | Actor  | Action                                     | System/UI          |
| ---- | ------ | ------------------------------------------ | ------------------ |
| 1    | User   | Navigates to SSH Keys page                 | /ssh-keys/\$teamId |
| 2    | User   | Clicks "Generate Key"                      | Dialog opens       |
| 3    | User   | Enters key name                            | &lt;Input&gt;      |
| 4    | User   | Selects key type: ed25519 (default) or rsa | &lt;Select&gt;     |
| 5    | User   | Clicks "Generate"                          | Submit             |
| 6    | System | Generates key pair, encrypts private key   | AES-GCM            |
| 7    | System | Stores public + encrypted private key      | Database insert    |

**Import Existing Key:**

| Step | Actor  | Action                                     | System/UI               |
| ---- | ------ | ------------------------------------------ | ----------------------- |
| 8    | User   | Clicks "Import Existing Key"               | Dialog opens            |
| 9    | User   | Enters name, pastes public and private key | &lt;textarea&gt; fields |
| 10   | User   | Clicks "Import Key"                        | Submit                  |
| 11   | System | Validates format, encrypts, stores         | Database insert         |

#### F2: Registry Credential Management

| Step | Actor  | Action                                                     | System/UI          |
| ---- | ------ | ---------------------------------------------------------- | ------------------ |
| 1    | User   | Navigates to Settings > Registries tab                     | &lt;Tabs&gt;       |
| 2    | User   | Clicks "Add Registry"                                      | Dialog opens       |
| 3    | User   | Enters name, selects type (Docker Hub, GHCR, ECR, Generic) | Form               |
| 4    | User   | Enters username, password/token                            | &lt;Input&gt;      |
| 5    | User   | (ECR) Enters AWS region, access key, secret                | Additional fields  |
| 6    | User   | Clicks "Add Registry"                                      | Submit             |
| 7    | System | Encrypts password, stores credential                       | AES encryption     |
| 8    | User   | Clicks validate icon                                       | &lt;Button&gt;     |
| 9    | System | Attempts authentication                                    | Backend validation |
| 10   | System | Shows green checkmark or error                             | Validated column   |

#### F3: Secret Management

(See C4: Environment Variable Management for CRUD workflow)

**Additional Features:** - **Version History:** Each update creates new version (v1, v2, v3…) - **Access Logging:** Every reveal logged with IP/timestamp - **Reveal Tracking:** - No reveal: Badge "No" (outline) - Revealed: Badge "Revealed" (secondary), eye button disabled

#### F4: Audit Log Review

| Step | Actor  | Action                     | System/UI                                |
| ---- | ------ | -------------------------- | ---------------------------------------- |
| 1    | User   | Navigates to team detail   | /teams/\$teamId                          |
| 2    | User   | Clicks "Audit Log" button  | &lt;Link&gt;                             |
| 3    | System | Loads audit log entries    | GET /api/v1/teams/{id}/audit-logs        |
| 4    | System | Displays paginated table   | Table: Time, Actor, Action, Resource, IP |
| 5    | User   | Enters action/actor filter | &lt;Input&gt;                            |
| 6    | System | Applies filters            | Query update                             |
| 7    | User   | Clicks "Load More"         | Cursor pagination                        |

**AuditLog Model:**

ID, TeamID, ActorID, ActorType (user|system|api_token),  
Action (create|update|delete|deploy|scale|...),  
ResourceType (app|server|database|...), ResourceID,  
Metadata (\[\]byte), IPAddress, CreatedAt

### G. Team & Governance (4 Workflows)

#### G1: Member Lifecycle

**View Members:**

| Step | Actor  | Action                                              | System/UI                        |
| ---- | ------ | --------------------------------------------------- | -------------------------------- |
| 1    | User   | Navigates to team detail                            | /teams/\$teamId                  |
| 2    | System | Shows members table                                 | Table: Name, Email, Role, Joined |
| 3    | System | Role badge: Owner (solid), Admin/Member (secondary) | Badge colors                     |

**Change Role:**

| Step | Actor  | Action                               | System/UI                        |
| ---- | ------ | ------------------------------------ | -------------------------------- |
| 4    | Owner  | Changes member role                  | PUT /teams/{id}/members/{userId} |
| 5    | System | Validates (cannot demote last owner) | Backend check                    |
| 6    | System | Updates membership                   | Database update                  |

**Remove Member:**

| Step | Actor       | Action                        | System/UI                           |
| ---- | ----------- | ----------------------------- | ----------------------------------- |
| 7    | Owner/Admin | Removes member                | DELETE /teams/{id}/members/{userId} |
| 8    | System      | Validates, deletes membership | Database delete                     |
| 9    | System      | Member loses all team access  | Immediate effect                    |

**Role Permissions Matrix:**

| Action         | Owner | Admin | Member    |
| -------------- | ----- | ----- | --------- |
| View team      | Yes   | Yes   | Yes       |
| Invite members | Yes   | Yes   | No        |
| Change roles   | Yes   | No    | No        |
| Remove members | Yes   | Yes\* | No        |
| Delete team    | Yes   | No    | No        |
| Manage servers | Yes   | Yes   | View only |
| Deploy apps    | Yes   | Yes   | Yes       |
| View audit log | Yes   | Yes   | No        |

\*Cannot remove owner

#### G2: Audit & Compliance Review

(See F4: Audit Log Review)

**Compliance Checklist:** - \[ \] All member role changes logged - \[ \] All credential rotations logged - \[ \] All deployments traceable to build + actor - \[ \] All secret access (reveals) logged with IP - \[ \] Server additions/removals documented - \[ \] Database provisioning with credential generation audited

#### G3: Resource Quota Management

**Per-Server Quotas:** - Memory limit: memory_limit_mb - CPU limit: cpu_limit_millicores - Disk: Volume size quota (size_gb)

**Per-Cluster Quotas:** - CIDR range limits member count

**Per-Database Quotas:** - CPU: resource_cpu_millicores - Memory: resource_memory_mb - Storage: Volume size

**Resource Limits Panel:**

| Step | Actor  | Action                                   | System/UI                     |
| ---- | ------ | ---------------------------------------- | ----------------------------- |
| 1    | User   | Navigates to app detail > Resources tab  | Resources panel               |
| 2    | User   | Sets memory limit (MB)                   | &lt;Input&gt; (0 = no limit)  |
| 3    | User   | Sets CPU limit (millicores)              | &lt;Input&gt; (1000 = 1 core) |
| 4    | User   | Clicks "Save Resource Limits"            | &lt;Button&gt;                |
| 5    | System | Calls PUT /api/v1/apps/{appId}/resources | API request                   |
| 6    | System | Applies on next deployment               | Not retroactive               |

#### G4: Team Settings & Configuration

**Rename Team:**

| Step | Actor  | Action                     | System/UI                |
| ---- | ------ | -------------------------- | ------------------------ |
| 1    | User   | Navigates to team settings | /teams/\$teamId/settings |
| 2    | User   | Modifies team name         | &lt;Input&gt;            |
| 3    | User   | Clicks "Save"              | &lt;Button&gt;           |
| 4    | System | Updates name and slug      | Slug auto-updates        |

**Delete Team:**

| Step | Actor  | Action                             | System/UI                            |
| ---- | ------ | ---------------------------------- | ------------------------------------ |
| 5    | Owner  | Clicks "Delete Team"               | &lt;Button variant="destructive"&gt; |
| 6    | System | Confirmation with consequences     | Dialog                               |
| 7    | Owner  | Confirms                           | Submit                               |
| 8    | System | Cascades deletion to all resources | Background job                       |
| 9    | System | Redirects to teams list            | Navigation                           |

**Team Deletion Consequences:** - All servers removed, clusters deleted, projects/apps deleted - All databases stopped and removed, secrets deleted - All SSH keys, registry credentials deleted - Audit logs archived then deleted

## 5.2 Workflow Priorities

### Priority Matrix

| Priority | Workflows                                                                                                           | User Impact                 | Implementation Effort |
| -------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------- |
| **P0**   | A1, A2, A3, B1, C1, C2, C3, C5, C7, D1, E1, E5, F1                                                                  | Core platform functionality | High                  |
| **P1**   | A4, A5, A6, B2, B3, B4, B5, C4, C6, C8, C9, C10, D2, D3, D4, D5, D6, E2, E3, E4, E6, E7, F2, F3, F4, G1, G2, G3, G4 | Important but not blocking  | Medium                |
| **P2**   | Advanced features (canary analysis, predictive scaling, etc.)                                                       | Nice to have                | High                  |

### Workflow Completion Status

| Category                 | Total  | Implemented | Partial | Missing                  |
| ------------------------ | ------ | ----------- | ------- | ------------------------ |
| A. Account & Access      | 6      | 6           | 0       | 0                        |
| B. Infrastructure        | 5      | 5           | 0       | 0                        |
| C. Application Lifecycle | 10     | 8           | 1       | 1 (Preview Environments) |
| D. Database Management   | 6      | 6           | 0       | 0                        |
| E. Operations            | 7      | 5           | 1       | 1 (Predictive Scaling)   |
| F. Security & Compliance | 4      | 4           | 0       | 0                        |
| G. Team & Governance     | 4      | 3           | 1       | 0                        |
| **Total**                | **42** | **37**      | **3**   | **2**                    |

# Part 6: Roadmap & Recommendations

## 6.1 Priority Matrix (P0/P1/P2/P3)

### P0 - CRITICAL (Must Have Before Commercial Launch)

These items are blockers for any production deployment with paying customers.

| #   | Feature                                   | Category       | Effort     | Business Impact | Technical Risk |
| --- | ----------------------------------------- | -------------- | ---------- | --------------- | -------------- |
| 1   | **Auto-Scaling Engine Redesign**          | Scaling        | 8 weeks    | Critical        | High           |
| 2   | **API Rate Limiting**                     | Security       | 1-2 weeks  | Critical        | Low            |
| 3   | **Billing & Usage Metering**              | Platform       | 6-8 weeks  | Critical        | Medium         |
| 4   | **Resource Quotas & Limits**              | Platform       | 3-4 weeks  | Critical        | Low            |
| 5   | **Plan Tiers (Free/Hobby/Pro)**           | Platform       | 2-3 weeks  | Critical        | Low            |
| 6   | **Health Check Customization**            | Infrastructure | 2-3 weeks  | High            | Medium         |
| 7   | **Preview Environments**                  | Core PaaS      | 3-4 weeks  | High            | Medium         |
| 8   | **Pipeline Stages (build→test→deploy)**   | Core PaaS      | 4-6 weeks  | High            | Medium         |
| 9   | **Cron Jobs / Scheduled Tasks**           | Core PaaS      | 2-3 weeks  | High            | Low            |
| 10  | **Background Workers**                    | Core PaaS      | 2-3 weeks  | High            | Low            |
| 11  | **Log Aggregation with Full-Text Search** | Operations     | 3-4 weeks  | High            | Medium         |
| 12  | **SSL Certificate Lifecycle Management**  | Infrastructure | 1-2 weeks  | High            | Low            |
| 13  | **CLI Enhancement (deploy, logs, env)**   | DevEx          | 4-5 weeks  | High            | Low            |
| 14  | **Frontend Migration (Next.js 15)**       | Frontend       | 8-10 weeks | High            | Medium         |

**Total P0 Effort: 50-65 weeks (parallelizable to ~6 months with 3-4 engineers)**

### P1 - IMPORTANT (Within 3-6 Months of Launch)

| #   | Feature                                           | Category       | Effort    | Business Impact | Technical Risk |
| --- | ------------------------------------------------- | -------------- | --------- | --------------- | -------------- |
| 15  | Blue-Green Deployments                            | Core PaaS      | 3-4 weeks | High            | Medium         |
| 16  | Canary Deployments with Auto-Rollback             | Core PaaS      | 4-5 weeks | High            | High           |
| 17  | Maintenance Mode                                  | Core PaaS      | 1 week    | Medium          | Low            |
| 18  | Release Management (promote)                      | Core PaaS      | 2-3 weeks | Medium          | Low            |
| 19  | Static Site Hosting                               | Core PaaS      | 2-3 weeks | Medium          | Medium         |
| 20  | Service Mesh Features (circuit breakers, retries) | Core PaaS      | 4-5 weeks | Medium          | High           |
| 21  | Graceful Shutdown Handling                        | Infrastructure | 2 weeks   | Medium          | Medium         |
| 22  | Sticky Sessions                                   | Infrastructure | 1-2 weeks | Medium          | Low            |
| 23  | DDoS Protection (rate limiting)                   | Infrastructure | 1-2 weeks | High            | Low            |
| 24  | Custom SSL Certificate Upload                     | Infrastructure | 1 week    | Medium          | Low            |
| 25  | CDN / Edge Caching                                | Infrastructure | 2-3 weeks | Medium          | Medium         |
| 26  | Cost Alerts & Budgets                             | Platform       | 1-2 weeks | Medium          | Low            |
| 27  | Team Collaboration (comments, @mentions)          | Platform       | 2-3 weeks | Medium          | Low            |
| 28  | User-Managed Webhooks                             | Platform       | 2-3 weeks | Medium          | Low            |
| 29  | Status Page / SLA                                 | Platform       | 2-3 weeks | Medium          | Low            |
| 30  | Terraform Provider                                | DevEx          | 4-5 weeks | Medium          | Medium         |
| 31  | GitHub Actions Integration                        | DevEx          | 1-2 weeks | Medium          | Low            |
| 32  | OpenAPI / Swagger Documentation                   | DevEx          | 2 weeks   | Medium          | Low            |
| 33  | API Client Libraries (Go, JS, Python)             | DevEx          | 4-6 weeks | Medium          | Medium         |
| 34  | Point-in-Time Recovery                            | Operations     | 3-4 weeks | High            | High           |
| 35  | Read Replicas for Databases                       | Operations     | 4-5 weeks | High            | High           |
| 36  | Distributed Tracing (OpenTelemetry)               | Operations     | 3-4 weeks | Medium          | Medium         |
| 37  | APM / Performance Monitoring                      | Operations     | 3-4 weeks | Medium          | Medium         |
| 38  | Volume Backup Scheduling                          | Operations     | 2-3 weeks | Medium          | Medium         |
| 39  | 2FA / MFA                                         | Security       | 3-4 weeks | High            | Medium         |
| 40  | Container Image Scanning                          | Security       | 2-3 weeks | Medium          | Medium         |

**Total P1 Effort: 58-78 weeks**

### P2 - NICE TO HAVE (6-12 Months)

| #   | Feature                           | Category       | Effort     | Business Impact | Technical Risk |
| --- | --------------------------------- | -------------- | ---------- | --------------- | -------------- |
| 41  | Multi-Region Deployment           | Core PaaS      | 8-10 weeks | High            | High           |
| 42  | Circuit Breakers                  | Infrastructure | 2-3 weeks  | Medium          | Medium         |
| 43  | Request Retries                   | Infrastructure | 1-2 weeks  | Low             | Medium         |
| 44  | WAF Rules                         | Infrastructure | 3-4 weeks  | Medium          | High           |
| 45  | IPv6 Support                      | Infrastructure | 3-4 weeks  | Low             | High           |
| 46  | One-Click Deployments (Templates) | Platform       | 2-3 weeks  | Medium          | Medium         |
| 47  | Service Marketplace               | Platform       | 4-5 weeks  | Medium          | Medium         |
| 48  | VS Code Extension                 | DevEx          | 3-4 weeks  | Low             | Low            |
| 49  | PWA Support                       | DevEx          | 2 weeks    | Low             | Low            |
| 50  | Disaster Recovery                 | Operations     | 4-6 weeks  | High            | High           |
| 51  | Cost Optimization Recommendations | Operations     | 2-3 weeks  | Low             | Medium         |
| 52  | Resource Usage Reports            | Operations     | 2-3 weeks  | Medium          | Low            |
| 53  | SSO / SAML Integration            | Security       | 4-6 weeks  | High            | Medium         |
| 54  | Audit Log Export                  | Security       | 1-2 weeks  | Medium          | Low            |

**Total P2 Effort: 42-58 weeks**

### P3 - FUTURE ROADMAP (12+ Months)

| #   | Feature                         | Category       | Effort     | Business Impact | Technical Risk |
| --- | ------------------------------- | -------------- | ---------- | --------------- | -------------- |
| 55  | Function-as-a-Service (FaaS)    | Core PaaS      | 8-10 weeks | Medium          | High           |
| 56  | Mobile App / Native             | DevEx          | 6-8 weeks  | Low             | Medium         |
| 57  | Template Marketplace            | Platform       | 4-6 weeks  | Low             | Medium         |
| 58  | SLA Tracking with Credits       | Platform       | 3-4 weeks  | Low             | Low            |
| 59  | AI-Powered Insights             | Operations     | 4-6 weeks  | Low             | High           |
| 60  | Global Edge Network             | Infrastructure | 8-12 weeks | High            | High           |
| 61  | Advanced Autoscaling (ML-based) | Scaling        | 6-8 weeks  | Medium          | High           |

**Total P3 Effort: 39-54 weeks**

## 6.2 12-Month Roadmap

### Quarter 1 (Months 1-3): Foundation

**Theme:** Fix critical gaps, prepare for commercial launch

| Week  | Focus                               | Key Deliverables                         |
| ----- | ----------------------------------- | ---------------------------------------- |
| 1-2   | Auto-scaling Phase 1-2              | Metrics pipeline, evaluation engine      |
| 3-4   | Auto-scaling Phase 3-4              | Decision engine, action executor         |
| 5-6   | Auto-scaling Phase 5-6              | Scheduled scaling, integration testing   |
| 7-8   | API Rate Limiting + Resource Quotas | Redis rate limiter, quota enforcement    |
| 9-10  | Frontend Migration Phase 1-2        | Next.js 15 setup, auth pages, layout     |
| 11-12 | Frontend Migration Phase 3          | Core pages (servers, clusters, projects) |

**Q1 Deliverables:** - \[ \] Auto-scaling engine v2 (container-level metrics, fast scaling) - \[ \] API rate limiting (per-IP, per-token, per-team) - \[ \] Resource quotas and limits - \[ \] Frontend foundation in Next.js 15 - \[ \] Health check customization

### Quarter 2 (Months 4-6): Core Features

**Theme:** Complete critical features, developer experience

| Week  | Focus                          | Key Deliverables                          |
| ----- | ------------------------------ | ----------------------------------------- |
| 13-14 | Frontend Migration Phase 4     | Feature parity, performance               |
| 15-16 | Billing & Usage Metering       | Usage tracking, Stripe integration        |
| 17-18 | Plan Tiers                     | Free/Hobby/Pro plans, feature gating      |
| 19-20 | Preview Environments           | PR-based ephemeral environments           |
| 21-22 | Pipeline Stages                | Build → Test → Deploy pipeline with gates |
| 23-24 | Cron Jobs + Background Workers | Cron scheduler, worker process type       |

**Q2 Deliverables:** - \[ \] Complete frontend migration to Next.js 15 - \[ \] Billing system with Stripe integration - \[ \] Plan tiers with feature gating - \[ \] Preview environments - \[ \] Pipeline stages - \[ \] Cron jobs and background workers - \[ \] Enhanced CLI (deploy, logs, env)

### Quarter 3 (Months 7-9): Scale & Polish

**Theme:** Advanced deployments, observability, security

| Week  | Focus                      | Key Deliverables                     |
| ----- | -------------------------- | ------------------------------------ |
| 25-26 | Blue-Green Deployments     | Parallel environment deployment      |
| 27-28 | Canary Deployments         | Percentage-based traffic splitting   |
| 29-30 | Log Aggregation            | Loki integration, full-text search   |
| 31-32 | SSL Certificate Management | Custom cert upload, monitoring       |
| 33-34 | 2FA / MFA                  | TOTP-based two-factor authentication |
| 35-36 | OpenAPI Documentation      | Generated API docs, client libraries |

**Q3 Deliverables:** - \[ \] Blue-green and canary deployments - \[ \] Log aggregation with search - \[ \] SSL certificate management - \[ \] Two-factor authentication - \[ \] OpenAPI documentation

### Quarter 4 (Months 10-12): Enterprise & Scale

**Theme:** Enterprise features, operational maturity

| Week  | Focus                    | Key Deliverables                 |
| ----- | ------------------------ | -------------------------------- |
| 37-38 | Read Replicas            | Database read replica support    |
| 39-40 | Point-in-Time Recovery   | WAL archiving, recovery UI       |
| 41-42 | Terraform Provider       | IaC support                      |
| 43-44 | Status Page              | Public status page               |
| 45-46 | Distributed Tracing      | OpenTelemetry integration        |
| 47-48 | Performance Optimization | Caching, CDN, performance tuning |

**Q4 Deliverables:** - \[ \] Database read replicas - \[ \] Point-in-time recovery - \[ \] Terraform provider - \[ \] Public status page - \[ \] Distributed tracing - \[ \] Performance optimizations

## 6.3 Effort Estimates

### Total Effort Summary

| Priority | Features | Total Effort | Parallel Team Size | Calendar Time |
| -------- | -------- | ------------ | ------------------ | ------------- |
| P0       | 14       | 50-65 weeks  | 4 engineers        | ~6 months     |
| P1       | 26       | 58-78 weeks  | 4 engineers        | ~7 months     |
| P2       | 14       | 42-58 weeks  | 3 engineers        | ~6 months     |
| P3       | 7        | 39-54 weeks  | 2 engineers        | ~7 months     |

**Grand Total: 189-255 engineering weeks** **With 5-engineer team: ~12-15 months for all priorities**

### Team Composition Recommendations

| Phase               | Backend | Frontend | DevOps | Total |
| ------------------- | ------- | -------- | ------ | ----- |
| Q1 (Foundation)     | 3       | 2        | 1      | 6     |
| Q2 (Core Features)  | 3       | 2        | 1      | 6     |
| Q3 (Scale & Polish) | 2       | 1        | 1      | 4     |
| Q4 (Enterprise)     | 2       | 1        | 1      | 4     |

## 6.4 Risk Assessment

### Risk Matrix

| Risk                                                     | Severity | Likelihood | Mitigation Strategy                                            |
| -------------------------------------------------------- | -------- | ---------- | -------------------------------------------------------------- |
| **Auto-scaling redesign introduces instability**         | Critical | Medium     | Extensive testing, feature flags, gradual rollout              |
| **Frontend migration causes feature regression**         | High     | Medium     | Comprehensive test suite, parallel deployment, gradual cutover |
| **Billing integration complexity**                       | High     | Medium     | Start with Stripe, simple metering, iterate                    |
| **Resource quota enforcement breaks existing workloads** | High     | Low        | Soft limits first, hard limits after grace period              |
| **No rate limiting leads to API abuse before fix**       | Critical | High       | Implement P0 item immediately (1-2 weeks)                      |
| **Database migration issues during scaling**             | High     | Low        | Backup before migration, rollback plan                         |
| **Team capacity constraints**                            | High     | High       | Prioritize ruthlessly, hire if needed                          |
| **Technical debt accumulation**                          | Medium   | High       | Allocate 20% of sprint capacity to debt reduction              |
| **Competitive pressure**                                 | Medium   | Medium     | Focus on unique differentiators (DB tooling, mesh networking)  |
| **Security vulnerabilities**                             | Critical | Medium     | Regular security audits, dependency scanning                   |

### Critical Path Analysis

The critical path for commercial readiness:

1\. API Rate Limiting (1-2 weeks) ──────────────────┐  
2\. Auto-Scaling Redesign (8 weeks) ────────────────┤  
3\. Resource Quotas (3-4 weeks) ────────────────────┤  
4\. Billing & Metering (6-8 weeks) ────────────────┤  
5\. Plan Tiers (2-3 weeks) ─────────────────────────┤  
▼  
Commercial Launch  
│  
6\. Frontend Migration (8-10 weeks) ────────────────┤  
7\. Preview Environments (3-4 weeks) ───────────────┤  
8\. Pipeline Stages (4-6 weeks) ────────────────────┤  
9\. Cron + Workers (2-3 weeks) ─────────────────────┤  
▼  
Competitive Parity

**Minimum time to commercial launch: 6-7 months with 4-5 engineers**

### Recommended Immediate Actions (Next 30 Days)

| Priority | Action                             | Owner         | Timeline |
| -------- | ---------------------------------- | ------------- | -------- |
| 1        | Implement API rate limiting        | Backend Team  | Week 1-2 |
| 2        | Begin auto-scaling engine redesign | Backend Team  | Week 1-8 |
| 3        | Start Next.js 15 project setup     | Frontend Team | Week 1-2 |
| 4        | Design billing system architecture | Backend Team  | Week 2-3 |
| 5        | Implement resource quotas          | Backend Team  | Week 3-4 |
| 6        | Add health check customization     | Backend Team  | Week 3-4 |
| 7        | Begin CLI enhancement              | Backend Team  | Week 4-6 |
| 8        | Implement cron jobs                | Backend Team  | Week 4-6 |

# Appendices

## A. Component Inventory

### A.1 shadcn/ui Components (Installed)

| Component      | Path                              | Usage Count | Status |
| -------------- | --------------------------------- | ----------- | ------ |
| Accordion      | components/ui/accordion.tsx       | Medium      | Keep   |
| Alert          | components/ui/alert.tsx           | High        | Keep   |
| AlertDialog    | components/ui/alert-dialog.tsx    | High        | Keep   |
| AspectRatio    | components/ui/aspect-ratio.tsx    | Low         | Keep   |
| Avatar         | components/ui/avatar.tsx          | High        | Keep   |
| Badge          | components/ui/badge.tsx           | High        | Keep   |
| Button         | components/ui/button.tsx          | Very High   | Keep   |
| Calendar       | components/ui/calendar.tsx        | Medium      | Keep   |
| Card           | components/ui/card.tsx            | Very High   | Keep   |
| Checkbox       | components/ui/checkbox.tsx        | Medium      | Keep   |
| Collapsible    | components/ui/collapsible.tsx     | Medium      | Keep   |
| Command        | components/ui/command.tsx         | Medium      | Keep   |
| ContextMenu    | components/ui/context-menu.tsx    | Low         | Keep   |
| Dialog         | components/ui/dialog.tsx          | Very High   | Keep   |
| DropdownMenu   | components/ui/dropdown-menu.tsx   | High        | Keep   |
| Form           | components/ui/form.tsx            | High        | Keep   |
| HoverCard      | components/ui/hover-card.tsx      | Low         | Keep   |
| Input          | components/ui/input.tsx           | Very High   | Keep   |
| Label          | components/ui/label.tsx           | High        | Keep   |
| Menubar        | components/ui/menubar.tsx         | Low         | Keep   |
| NavigationMenu | components/ui/navigation-menu.tsx | Low         | Keep   |
| Popover        | components/ui/popover.tsx         | High        | Keep   |
| Progress       | components/ui/progress.tsx        | Medium      | Keep   |
| RadioGroup     | components/ui/radio-group.tsx     | Medium      | Keep   |
| Resizable      | components/ui/resizable.tsx       | Low         | Keep   |
| ScrollArea     | components/ui/scroll-area.tsx     | Medium      | Keep   |
| Select         | components/ui/select.tsx          | High        | Keep   |
| Separator      | components/ui/separator.tsx       | Medium      | Keep   |
| Sheet          | components/ui/sheet.tsx           | Medium      | Keep   |
| Skeleton       | components/ui/skeleton.tsx        | High        | Keep   |
| Slider         | components/ui/slider.tsx          | Medium      | Keep   |
| Switch         | components/ui/switch.tsx          | Medium      | Keep   |
| Table          | components/ui/table.tsx           | High        | Keep   |
| Tabs           | components/ui/tabs.tsx            | Very High   | Keep   |
| Textarea       | components/ui/textarea.tsx        | High        | Keep   |
| Toast          | components/ui/toast.tsx           | High        | Keep   |
| Toaster        | components/ui/toaster.tsx         | High        | Keep   |
| Toggle         | components/ui/toggle.tsx          | Low         | Keep   |
| ToggleGroup    | components/ui/toggle-group.tsx    | Low         | Keep   |
| Tooltip        | components/ui/tooltip.tsx         | Medium      | Keep   |

### A.2 Custom Components

| Component              | Path                                    | Purpose                   | Migration Status               |
| ---------------------- | --------------------------------------- | ------------------------- | ------------------------------ |
| ActionButton           | components/action-button.tsx            | CRUD action button        | Migrate to shadcn Button       |
| ActionDialog           | components/action-dialog.tsx            | Generic action dialog     | Migrate to shadcn Dialog       |
| AppBreadcrumb          | components/app-breadcrumb.tsx           | Breadcrumb navigation     | Keep (custom)                  |
| AppLayout              | components/app-layout.tsx               | Main layout wrapper       | Migrate to Next.js layout      |
| CardSkeleton           | components/card-skeleton.tsx            | Loading skeleton          | Migrate to shadcn Skeleton     |
| ClusterStatusIndicator | components/cluster-status-indicator.tsx | Cluster health indicator  | Keep (custom)                  |
| ContainerLogsPanel     | components/container-logs-panel.tsx     | Container log viewer      | Keep (custom)                  |
| CreateClusterDialog    | components/create-cluster-dialog.tsx    | Cluster creation          | Migrate to shadcn Dialog       |
| CreateDatabaseDialog   | components/create-database-dialog.tsx   | Database provisioning     | Migrate to shadcn Dialog       |
| CreateServerDialog     | components/create-server-dialog.tsx     | Server registration       | Migrate to shadcn Dialog       |
| CreateTeamDialog       | components/create-team-dialog.tsx       | Team creation             | Migrate to shadcn Dialog       |
| DataTable              | components/data-table.tsx               | Sortable/filterable table | Migrate to shadcn Table        |
| DatabaseTerminal       | components/database-terminal.tsx        | DB CLI terminal           | Keep (xterm.js)                |
| DeleteDialog           | components/delete-dialog.tsx            | Deletion confirmation     | Migrate to shadcn AlertDialog  |
| DeploymentTargets      | components/deployment-targets.tsx       | Deployment target list    | Keep (custom)                  |
| FormField              | components/form-field.tsx               | Form field wrapper        | Migrate to shadcn Form         |
| FormSection            | components/form-section.tsx             | Form section wrapper      | Keep (custom)                  |
| Icon                   | components/icon.tsx                     | Icon wrapper              | Replace with Lucide            |
| InviteMemberDialog     | components/invite-member-dialog.tsx     | Member invitation         | Migrate to shadcn Dialog       |
| JsonEditor             | components/json-editor.tsx              | JSON editing              | Keep (custom)                  |
| LogsPanel              | components/logs-panel.tsx               | Log viewer panel          | Keep (custom)                  |
| MetricsChart           | components/metrics-chart.tsx            | Time-series chart         | Keep (Recharts)                |
| MetricChartQuery       | components/metric-chart-query.tsx       | Metric chart with data    | Keep (Recharts)                |
| MonospaceCard          | components/monospace-card.tsx           | Monospace display card    | Keep (custom)                  |
| NotificationDropdown   | components/notification-dropdown.tsx    | Notification panel        | Migrate to shadcn DropdownMenu |
| QueryResultTable       | components/query-result-table.tsx       | SQL query results         | Migrate to shadcn Table        |
| QueryHistory           | components/query-history.tsx            | Query history list        | Keep (custom)                  |
| RowPage                | components/row-page.tsx                 | Paginated row display     | Migrate to shadcn Table        |
| SearchInput            | components/search-input.tsx             | Search input field        | Migrate to shadcn Input        |
| SecretEditor           | components/secret-editor.tsx            | Secret CRUD               | Migrate to shadcn components   |
| SectionCard            | components/section-card.tsx             | Card with header          | Migrate to shadcn Card         |
| SectionHeader          | components/section-header.tsx           | Section title + actions   | Keep (custom)                  |
| ServerStatusBadge      | components/server-status-badge.tsx      | Server status indicator   | Keep (custom)                  |
| ServerFormFields       | components/server-form-fields.tsx       | Server form inputs        | Migrate to shadcn Form         |
| Sidebar                | components/sidebar.tsx                  | Navigation sidebar        | Migrate to shadcn + custom     |
| StatusBadge            | components/status-badge.tsx             | Generic status badge      | Migrate to shadcn Badge        |
| TableSkeleton          | components/table-skeleton.tsx           | Table loading skeleton    | Migrate to shadcn Skeleton     |
| TeamDropdown           | components/team-dropdown.tsx            | Team switcher             | Migrate to shadcn DropdownMenu |
| Terminal               | components/terminal.tsx                 | xterm.js terminal         | Keep (xterm.js)                |
| ThemeToggle            | components/theme-toggle.tsx             | Dark/light toggle         | Keep (custom)                  |
| UpdateTeamDialog       | components/update-team-dialog.tsx       | Team rename               | Migrate to shadcn Dialog       |
| WebhookListener        | components/webhook-listener.tsx         | Webhook event handler     | Keep (custom)                  |

### A.3 Custom Components to Build

| Component       | Purpose                    | Dependencies            |
| --------------- | -------------------------- | ----------------------- |
| StatusBadge     | Resource status indicators | Badge + custom colors   |
| ResourceMeter   | CPU/Memory/Disk gauges     | Progress + custom       |
| CommandPalette  | CMD+K quick actions        | Command + custom        |
| EmptyState      | Empty list illustrations   | Custom + Lucide         |
| CopyButton      | Copy-to-clipboard          | Button + Clipboard API  |
| ConfirmDialog   | Confirmation dialogs       | AlertDialog + custom    |
| FormWizard      | Multi-step forms           | Custom + Radix          |
| CodeBlock       | Syntax-highlighted code    | Custom + Prism          |
| DateRangePicker | Date range selection       | Calendar + Popover      |
| FileUpload      | File upload with drag-drop | Custom + Radix          |
| ImageGallery    | Image grid with preview    | Custom + Dialog         |
| InfiniteScroll  | Infinite scroll container  | Custom + TanStack Query |
| LoadingOverlay  | Full-screen loading state  | Custom + Skeleton       |
| Pagination      | Page-based pagination      | Custom + shadcn         |
| SortableTable   | Drag-drop sortable table   | Table + @dnd-kit        |
| Timeline        | Vertical event timeline    | Custom + Lucide         |

## B. API Endpoint Inventory

### B.1 Public Endpoints (No Authentication)

| Method | Path                                  | Description              |
| ------ | ------------------------------------- | ------------------------ |
| GET    | /agent/download/{arch}                | Download agent binary    |
| POST   | /api/v1/auth/signup                   | User registration        |
| POST   | /api/v1/auth/login                    | User login               |
| POST   | /api/v1/auth/verify-email             | Email verification       |
| POST   | /api/v1/auth/forgot-password          | Password reset request   |
| POST   | /api/v1/auth/reset-password           | Password reset execution |
| POST   | /api/v1/webhooks/github/{appId}       | GitHub app webhook       |
| POST   | /api/v1/webhooks/github/team/{teamId} | GitHub team webhook      |
| GET    | /healthz                              | Health check             |

### B.2 Authentication Endpoints

| Method | Path                | Description      |
| ------ | ------------------- | ---------------- |
| POST   | /api/v1/auth/logout | User logout      |
| GET    | /api/v1/auth/me     | Get current user |

### B.3 Team Endpoints

| Method | Path                                  | Description        |
| ------ | ------------------------------------- | ------------------ |
| POST   | /api/v1/teams                         | Create team        |
| GET    | /api/v1/teams                         | List teams         |
| GET    | /api/v1/teams/{id}                    | Get team           |
| PUT    | /api/v1/teams/{id}                    | Update team        |
| DELETE | /api/v1/teams/{id}                    | Delete team        |
| GET    | /api/v1/teams/{id}/members            | List members       |
| PUT    | /api/v1/teams/{id}/members/{userID}   | Update member role |
| DELETE | /api/v1/teams/{id}/members/{userID}   | Remove member      |
| POST   | /api/v1/teams/{id}/invites            | Create invite      |
| GET    | /api/v1/teams/{id}/invites            | List invites       |
| DELETE | /api/v1/teams/{id}/invites/{inviteID} | Cancel invite      |
| POST   | /api/v1/invites/accept                | Accept invite      |
| POST   | /api/v1/teams/{id}/tokens             | Create API token   |
| GET    | /api/v1/teams/{id}/tokens             | List tokens        |
| DELETE | /api/v1/teams/{id}/tokens/{tokenID}   | Revoke token       |
| GET    | /api/v1/teams/{id}/audit-logs         | List audit logs    |

### B.4 Server Endpoints

| Method | Path                                                         | Description           |
| ------ | ------------------------------------------------------------ | --------------------- |
| POST   | /api/v1/teams/{id}/servers                                   | Create server         |
| GET    | /api/v1/teams/{id}/servers                                   | List servers          |
| GET    | /api/v1/teams/{id}/servers/{serverId}                        | Get server            |
| PUT    | /api/v1/teams/{id}/servers/{serverId}                        | Update server         |
| DELETE | /api/v1/teams/{id}/servers/{serverId}                        | Delete server         |
| POST   | /api/v1/teams/{id}/servers/{serverId}/cleanup                | Docker cleanup        |
| GET    | /api/v1/teams/{id}/servers/{serverId}/tags                   | List tags             |
| POST   | /api/v1/teams/{id}/servers/{serverId}/tags                   | Set tag               |
| DELETE | /api/v1/teams/{id}/servers/{serverId}/tags/{key}             | Delete tag            |
| POST   | /api/v1/teams/{id}/servers/{serverId}/provision              | Start provisioning    |
| GET    | /api/v1/teams/{id}/servers/{serverId}/provision              | Get provision status  |
| GET    | /api/v1/teams/{id}/servers/{serverId}/provision/{jobId}/logs | Stream provision logs |
| POST   | /api/v1/teams/{id}/servers/{serverId}/provision/retry        | Retry provisioning    |
| GET    | /api/v1/teams/{id}/servers/{serverId}/terminal               | WebSocket terminal    |
| GET    | /api/v1/teams/{id}/servers/{serverId}/logs                   | Server logs SSE       |

### B.5 Cluster Endpoints

| Method | Path                                                       | Description     |
| ------ | ---------------------------------------------------------- | --------------- |
| POST   | /api/v1/teams/{id}/clusters                                | Create cluster  |
| GET    | /api/v1/teams/{id}/clusters                                | List clusters   |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}                    | Get cluster     |
| PUT    | /api/v1/teams/{id}/clusters/{clusterId}                    | Update cluster  |
| DELETE | /api/v1/teams/{id}/clusters/{clusterId}                    | Delete cluster  |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}/members            | List members    |
| POST   | /api/v1/teams/{id}/clusters/{clusterId}/members            | Add member      |
| DELETE | /api/v1/teams/{id}/clusters/{clusterId}/members/{serverId} | Remove member   |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}/mesh               | Mesh health     |
| POST   | /api/v1/teams/{id}/clusters/{clusterId}/mesh/regenerate    | Regenerate mesh |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}/mesh/logs          | Mesh logs SSE   |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}/events             | Cluster events  |

### B.6 GitHub Endpoints

| Method | Path                                                           | Description                |
| ------ | -------------------------------------------------------------- | -------------------------- |
| POST   | /api/v1/teams/{id}/github/manifest                             | Create GitHub app manifest |
| POST   | /api/v1/teams/{id}/github/callback                             | GitHub callback            |
| GET    | /api/v1/teams/{id}/github/app                                  | Get GitHub app             |
| DELETE | /api/v1/teams/{id}/github/app                                  | Delete GitHub app          |
| GET    | /api/v1/teams/{id}/github/installations                        | List installations         |
| POST   | /api/v1/teams/{id}/github/installations/sync                   | Sync installations         |
| GET    | /api/v1/teams/{id}/github/installations/{installationId}/repos | List repos                 |

### B.7 Registry Endpoints

| Method | Path                                                | Description                |
| ------ | --------------------------------------------------- | -------------------------- |
| POST   | /api/v1/teams/{id}/registries                       | Create registry credential |
| GET    | /api/v1/teams/{id}/registries                       | List registry credentials  |
| GET    | /api/v1/teams/{id}/registries/{registryId}          | Get credential             |
| PUT    | /api/v1/teams/{id}/registries/{registryId}          | Update credential          |
| DELETE | /api/v1/teams/{id}/registries/{registryId}          | Delete credential          |
| POST   | /api/v1/teams/{id}/registries/{registryId}/validate | Validate credential        |

### B.8 SSH Key Endpoints

| Method | Path                                | Description    |
| ------ | ----------------------------------- | -------------- |
| POST   | /api/v1/teams/{id}/ssh-keys         | Create SSH key |
| GET    | /api/v1/teams/{id}/ssh-keys         | List SSH keys  |
| GET    | /api/v1/teams/{id}/ssh-keys/{keyID} | Get SSH key    |
| DELETE | /api/v1/teams/{id}/ssh-keys/{keyID} | Delete SSH key |

### B.9 Project Endpoints

| Method | Path                                        | Description        |
| ------ | ------------------------------------------- | ------------------ |
| POST   | /api/v1/teams/{teamId}/projects             | Create project     |
| GET    | /api/v1/teams/{teamId}/projects             | List projects      |
| GET    | /api/v1/teams/{teamId}/projects/{projectId} | Get project        |
| PUT    | /api/v1/teams/{teamId}/projects/{projectId} | Update project     |
| DELETE | /api/v1/teams/{teamId}/projects/{projectId} | Delete project     |
| POST   | /api/v1/projects/{projectId}/environments   | Create environment |
| GET    | /api/v1/projects/{projectId}/environments   | List environments  |

### B.10 App Endpoints

| Method | Path                                      | Description             |
| ------ | ----------------------------------------- | ----------------------- |
| POST   | /api/v1/projects/{projectId}/apps         | Create app              |
| GET    | /api/v1/projects/{projectId}/apps         | List apps               |
| GET    | /api/v1/projects/{projectId}/apps/{appId} | Get app                 |
| PUT    | /api/v1/projects/{projectId}/apps/{appId} | Update app              |
| DELETE | /api/v1/projects/{projectId}/apps/{appId} | Delete app              |
| GET    | /api/v1/apps/{appId}                      | Get app (direct)        |
| POST   | /api/v1/apps/{appId}/domain               | Set custom domain       |
| POST   | /api/v1/apps/{appId}/domain/verify        | Verify domain DNS       |
| PUT    | /api/v1/apps/{appId}/resources            | Update resource limits  |
| PUT    | /api/v1/apps/{appId}/registry-credential  | Set registry credential |

### B.11 Build Endpoints

| Method | Path                                       | Description    |
| ------ | ------------------------------------------ | -------------- |
| POST   | /api/v1/apps/{appId}/builds                | Trigger build  |
| GET    | /api/v1/apps/{appId}/builds                | List builds    |
| GET    | /api/v1/apps/{appId}/builds/{buildId}      | Get build      |
| GET    | /api/v1/apps/{appId}/builds/{buildId}/logs | Build logs SSE |

### B.12 Deployment Endpoints

| Method | Path                                                      | Description                  |
| ------ | --------------------------------------------------------- | ---------------------------- |
| POST   | /api/v1/apps/{appId}/deployments                          | Create deployment            |
| GET    | /api/v1/apps/{appId}/deployments                          | List deployments             |
| GET    | /api/v1/apps/{appId}/deployments/{deployId}               | Get deployment               |
| GET    | /api/v1/apps/{appId}/deployments/{deployId}/logs          | Deployment logs SSE          |
| GET    | /api/v1/apps/{appId}/deployments/{deployId}/targets       | List targets                 |
| POST   | /api/v1/apps/{appId}/rollback                             | Rollback deployment          |
| POST   | /api/v1/apps/{appId}/scale                                | Scale app                    |
| GET    | /api/v1/apps/{appId}/scaling-events                       | List scaling events          |
| POST   | /api/v1/apps/{appId}/autoscaling-rules                    | Create autoscaling rule      |
| GET    | /api/v1/apps/{appId}/autoscaling-rules                    | List autoscaling rules       |
| DELETE | /api/v1/apps/{appId}/autoscaling-rules/{ruleId}           | Delete autoscaling rule      |
| POST   | /api/v1/apps/{appId}/autoscaling/evaluate                 | Evaluate autoscaling         |
| GET    | /api/v1/apps/{appId}/traffic                              | Get traffic routes           |
| PUT    | /api/v1/apps/{appId}/traffic                              | Update traffic weights       |
| POST   | /api/v1/apps/{appId}/traffic/backends/{backendId}/promote | Promote backend              |
| GET    | /api/v1/apps/{appId}/logs                                 | Container logs SSE           |
| POST   | /api/v1/apps/{appId}/cleanup                              | Cleanup old deployments      |
| GET    | /api/v1/apps/{appId}/replicas                             | List replicas                |
| POST   | /api/v1/apps/{appId}/containers/{containerName}/restart   | Restart container            |
| POST   | /api/v1/apps/{appId}/containers/{containerName}/stop      | Stop container               |
| GET    | /api/v1/apps/{appId}/containers/{containerName}/inspect   | Inspect container            |
| GET    | /api/v1/apps/{appId}/logs/search                          | Search logs                  |
| GET    | /api/v1/apps/{appId}/logs/history                         | Historical logs              |
| GET    | /api/v1/apps/{appId}/terminal                             | Container terminal WebSocket |

### B.13 Secret Endpoints

| Method | Path                                         | Description   |
| ------ | -------------------------------------------- | ------------- |
| POST   | /api/v1/teams/{id}/secrets                   | Create secret |
| GET    | /api/v1/teams/{id}/secrets                   | List secrets  |
| GET    | /api/v1/teams/{id}/secrets/{secretId}        | Get secret    |
| POST   | /api/v1/teams/{id}/secrets/{secretId}/reveal | Reveal secret |
| PUT    | /api/v1/teams/{id}/secrets/{secretId}        | Update secret |
| DELETE | /api/v1/teams/{id}/secrets/{secretId}        | Delete secret |

### B.14 Volume Endpoints

| Method | Path                                            | Description     |
| ------ | ----------------------------------------------- | --------------- |
| POST   | /api/v1/teams/{id}/volumes                      | Create volume   |
| GET    | /api/v1/teams/{id}/volumes                      | List volumes    |
| GET    | /api/v1/teams/{id}/volumes/{volumeId}           | Get volume      |
| DELETE | /api/v1/teams/{id}/volumes/{volumeId}           | Delete volume   |
| POST   | /api/v1/teams/{id}/volumes/{volumeId}/attach    | Attach volume   |
| POST   | /api/v1/teams/{id}/volumes/{volumeId}/detach    | Detach volume   |
| POST   | /api/v1/teams/{id}/volumes/{volumeId}/move      | Move volume     |
| POST   | /api/v1/teams/{id}/volumes/{volumeId}/snapshot  | Create snapshot |
| POST   | /api/v1/teams/{id}/volumes/{volumeId}/resize    | Resize volume   |
| GET    | /api/v1/teams/{id}/volumes/{volumeId}/snapshots | List snapshots  |

### B.15 Database Endpoints

| Method | Path                                                                   | Description        |
| ------ | ---------------------------------------------------------------------- | ------------------ |
| POST   | /api/v1/projects/{projectId}/databases                                 | Provision database |
| GET    | /api/v1/projects/{projectId}/databases                                 | List databases     |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}                    | Get database       |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}/provision-stream   | Provisioning SSE   |
| DELETE | /api/v1/projects/{projectId}/databases/{databaseId}                    | Delete database    |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/stop               | Stop database      |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/start              | Start database     |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/rebind-volume      | Rebind volume      |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/links              | Link to app        |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}/links              | List links         |
| DELETE | /api/v1/projects/{projectId}/databases/{databaseId}/links/{linkId}     | Unlink app         |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/rotate             | Rotate credentials |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}/rotations          | List rotations     |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/backups            | Create backup      |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}/backups            | List backups       |
| GET    | /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId} | Get backup         |
| DELETE | /api/v1/projects/{projectId}/databases/{databaseId}/backups/{backupId} | Delete backup      |
| POST   | /api/v1/projects/{projectId}/databases/{databaseId}/restore            | Restore backup     |

### B.16 Database Tooling Endpoints

| Method | Path                                                                | Description           |
| ------ | ------------------------------------------------------------------- | --------------------- |
| GET    | /api/v1/databases/{databaseId}                                      | Get database (direct) |
| GET    | /api/v1/databases/{databaseId}/terminal                             | Database terminal     |
| GET    | /api/v1/databases/{databaseId}/schemas                              | List schemas          |
| GET    | /api/v1/databases/{databaseId}/schemas/{schema}/tables              | List tables           |
| GET    | /api/v1/databases/{databaseId}/schemas/{schema}/tables/{table}/rows | Get rows              |
| POST   | /api/v1/databases/{databaseId}/query                                | Run query             |
| GET    | /api/v1/databases/{databaseId}/query-history                        | Query history         |
| GET    | /api/v1/databases/{databaseId}/redis/keys                           | Redis keys            |
| GET    | /api/v1/databases/{databaseId}/redis/key                            | Redis get key         |
| GET    | /api/v1/databases/{databaseId}/redis/info                           | Redis info            |
| GET    | /api/v1/databases/{databaseId}/redis/config                         | Redis config          |
| GET    | /api/v1/databases/{databaseId}/mongo/collections                    | Mongo collections     |
| GET    | /api/v1/databases/{databaseId}/mongo/collections/{collection}/find  | Mongo find            |
| GET    | /api/v1/databases/{databaseId}/mongo/collections/{collection}/doc   | Mongo document        |
| POST   | /api/v1/projects/{projectId}/saved-queries                          | Save query            |
| GET    | /api/v1/projects/{projectId}/saved-queries                          | List saved queries    |

### B.17 Observability Endpoints

| Method | Path                                                                     | Description                |
| ------ | ------------------------------------------------------------------------ | -------------------------- |
| GET    | /api/v1/teams/{id}/observability/metrics                                 | Query metrics              |
| GET    | /api/v1/teams/{id}/observability/alerts                                  | List alerts                |
| POST   | /api/v1/teams/{id}/observability/alerts                                  | Create alert               |
| PUT    | /api/v1/teams/{id}/observability/alerts/{alertId}                        | Update alert               |
| DELETE | /api/v1/teams/{id}/observability/alerts/{alertId}                        | Delete alert               |
| POST   | /api/v1/teams/{id}/observability/alerts/evaluate                         | Evaluate alerts            |
| GET    | /api/v1/teams/{id}/observability/events                                  | Alert events               |
| GET    | /api/v1/teams/{id}/observability/channels                                | List notification channels |
| POST   | /api/v1/teams/{id}/observability/channels                                | Create channel             |
| POST   | /api/v1/teams/{id}/observability/silences                                | Create silence             |
| GET    | /api/v1/teams/{id}/clusters/{clusterId}/observability/scrape-config      | Scrape config              |
| POST   | /api/v1/teams/{id}/clusters/{clusterId}/observability/scrape-config/sync | Sync scrape config         |

### B.18 Template Endpoints

| Method | Path                              | Description            |
| ------ | --------------------------------- | ---------------------- |
| GET    | /api/v1/templates                 | List templates         |
| GET    | /api/v1/templates/{slug}          | Get template           |
| GET    | /api/v1/templates/{slug}/versions | List template versions |

### B.19 Storage Endpoints

| Method | Path                                  | Description    |
| ------ | ------------------------------------- | -------------- |
| GET    | /api/v1/admin/platform/storage/status | Storage status |

### B.20 Discovery Endpoints

| Method | Path             | Description        |
| ------ | ---------------- | ------------------ |
| POST   | /api/v1/discover | Discovery endpoint |

**Total API Endpoints: ~155+**

## C. Database Schema Overview

### C.1 Core Identity Tables

| Table            | Purpose                | Key Fields                                                                                              |
| ---------------- | ---------------------- | ------------------------------------------------------------------------------------------------------- |
| users            | Platform users         | id, email, password_hash, name, email_verified, created_at                                              |
| teams            | Organizations          | id, name, slug, created_at, updated_at                                                                  |
| team_memberships | User-team associations | id, team_id, user_id, role, created_at                                                                  |
| team_invites     | Pending invitations    | id, team_id, email, role, token, expires_at                                                             |
| api_tokens       | Scoped API tokens      | id, team_id, name, token_hash, scopes, expires_at                                                       |
| audit_logs       | Activity audit trail   | id, team_id, actor_id, actor_type, action, resource_type, resource_id, metadata, ip_address, created_at |

### C.2 Infrastructure Tables

| Table            | Purpose              | Key Fields                                                                                           |
| ---------------- | -------------------- | ---------------------------------------------------------------------------------------------------- |
| servers          | Registered servers   | id, team_id, agent_id, name, hostname, public_ip, ssh_port, ssh_user, status, metadata, last_seen_at |
| server_tags      | Server metadata      | id, server_id, key, value                                                                            |
| server_resources | Server hardware info | id, server_id, cpu_cores, memory_total, disk_total, os, arch                                         |
| ssh_keys         | SSH key pairs        | id, team_id, name, public_key, private_key_encrypted, key_type, fingerprint                          |
| clusters         | Server clusters      | id, team_id, name, slug, description, region, cidr, status                                           |
| cluster_members  | Cluster membership   | id, cluster_id, server_id, wireguard_ip, public_key, status                                          |
| wireguard_peers  | Mesh peer status     | id, cluster_id, server_id, peer_server_id, endpoint, allowed_ips, status                             |
| mesh_events      | Mesh network events  | id, cluster_id, event_type, server_id, peer_server_id, metadata, created_at                          |

### C.3 Project Tables

| Table              | Purpose               | Key Fields                                                                                                                              |
| ------------------ | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| projects           | Deployment projects   | id, team_id, cluster_id, name, slug, description, status                                                                                |
| environments       | Project environments  | id, project_id, name, slug, description                                                                                                 |
| apps               | Applications          | id, project_id, name, slug, source_type, repo, branch, builder, port, health_check_path, replicas, placement_strategy, status, metadata |
| builds             | Build records         | id, app_id, environment_id, trigger_type, commit_sha, builder, image_tag, status, logs, started_at, completed_at                        |
| deployments        | Deployment records    | id, app_id, environment_id, build_id, strategy, replicas_desired, replicas_ready, env_snapshot, status, platform_domain                 |
| deployment_targets | Per-server targets    | id, deployment_id, server_id, container_id, status, health_check_attempts                                                               |
| scaling_events     | Scaling event log     | id, app_id, event_type, from_replicas, to_replicas, metric_name, metric_value, rule_name, message                                       |
| autoscaling_rules  | Autoscaling config    | id, app_id, name, metric_name, comparison, threshold, duration_seconds, action_type, action_value, min_replicas, max_replicas           |
| traffic_routes     | Traffic routing       | id, app_id, environment_id, domain, mode, status                                                                                        |
| traffic_backends   | Traffic backends      | id, route_id, deployment_id, label, weight, status                                                                                      |
| traffic_events     | Traffic change events | id, route_id, actor_id, actor_type, event_type, message, metadata                                                                       |

### C.4 Database Tables

| Table                         | Purpose             | Key Fields                                                                                                                                                             |
| ----------------------------- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| databases                     | Managed databases   | id, team_id, project_id, cluster_id, server_id, template_slug, version, name, container_name, status, port, dns_record, resource_cpu, resource_memory, backup_schedule |
| database_backups              | Backup records      | id, database_id, type, status, size_bytes, storage_type, storage_path, started_at, completed_at                                                                        |
| database_credential_rotations | Rotation history    | id, database_id, status, linked_apps_restarted, created_at                                                                                                             |
| database_links                | App-database links  | id, database_id, app_id, env_prefix                                                                                                                                    |
| database_query_history        | Query execution log | id, database_id, query, success, execution_time_ms, created_at                                                                                                         |
| database_saved_queries        | Saved queries       | id, project_id, name, query, created_at                                                                                                                                |

### C.5 Storage Tables

| Table                | Purpose                 | Key Fields                                                                                 |
| -------------------- | ----------------------- | ------------------------------------------------------------------------------------------ |
| volumes              | Persistent volumes      | id, team_id, server_id, name, size_gb, mount_point, status                                 |
| volume_snapshots     | Volume snapshots        | id, volume_id, size_bytes, storage_path, created_at                                        |
| registry_credentials | Container registry auth | id, team_id, name, registry_type, registry_url, username, password_encrypted, validated_at |
| secrets              | Encrypted secrets       | id, team_id, environment, key, encrypted_value, version, revealed_at                       |
| secret_access_logs   | Secret access audit     | id, secret_id, actor_id, action, ip_address, created_at                                    |

### C.6 GitHub Tables

| Table                 | Purpose                  | Key Fields                                                 |
| --------------------- | ------------------------ | ---------------------------------------------------------- |
| github_apps           | GitHub app registrations | id, team_id, app_id, private_key, webhook_secret           |
| github_installations  | App installations        | id, team_id, github_app_id, installation_id, account_login |
| github_webhook_events | Webhook event log        | id, installation_id, event_type, payload, processed        |

### C.7 Observability Tables

| Table                 | Purpose                   | Key Fields                                                                                     |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| metric_samples        | Time-series metrics       | id, scope_type, scope_id, metric_name, value, labels, sampled_at                               |
| alert_rules           | Alert configuration       | id, team_id, scope_type, scope_id, name, metric_name, comparison, threshold, severity, enabled |
| alert_events          | Alert state changes       | id, rule_id, state, message, created_at                                                        |
| alert_silences        | Alert silencing           | id, team_id, rule_id, scope_type, scope_id, reason, starts_at, ends_at                         |
| notification_channels | Notification destinations | id, team_id, name, type, target, enabled                                                       |
| terminal_sessions     | Terminal session log      | id, user_id, team_id, server_id, started_at, ended_at                                          |

## D. Competitive Feature Matrix

### D.1 Feature Comparison: Nixway vs Industry Leaders

| Feature Category         | Feature                     | Nixway Core | Railway | Render | Fly.io          | Heroku         | DO Apps |
| ------------------------ | --------------------------- | ----------- | ------- | ------ | --------------- | -------------- | ------- |
| **Core Platform**        |                             |             |         |        |                 |                |         |
|                          | Git-based Deployments       | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | GitHub App Integration      | Yes         | Yes     | Yes    | No              | Yes            | Yes     |
|                          | Auto-Detect Framework       | Yes         | Yes     | Yes    | No              | Yes            | Yes     |
|                          | Rolling Deployments         | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Preview Environments        | **No**      | Yes     | Yes    | Manual          | Yes            | Yes     |
|                          | Blue-Green Deployments      | **No**      | No      | Yes    | No              | No             | No      |
|                          | Canary Deployments          | **No**      | No      | No     | Manual          | No             | No      |
|                          | Cron Jobs                   | **No**      | Yes     | Yes    | Yes             | Add-on         | Yes     |
|                          | Background Workers          | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Static Site Hosting         | **No**      | Yes     | Yes    | Manual          | No             | Yes     |
|                          | Maintenance Mode            | **No**      | No      | No     | No              | Yes            | No      |
|                          | Release Management          | Partial     | Basic   | Yes    | Yes             | Yes            | Yes     |
| **Networking**           |                             |             |         |        |                 |                |         |
|                          | Custom Domains              | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Wildcard Domains            | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Automatic SSL               | Basic       | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Custom SSL Certificates     | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | CDN / Edge Caching          | **No**      | No      | Yes    | No              | No             | Yes     |
|                          | DDoS Protection             | **No**      | No      | Yes    | No              | No             | Yes     |
|                          | IPv6 Support                | **No**      | No      | No     | No              | No             | No      |
|                          | Service Mesh                | Partial     | No      | No     | No              | No             | No      |
|                          | Private Networking          | Yes (WG)    | Yes     | Yes    | Yes             | Private Spaces | Yes     |
| **Databases**            |                             |             |         |        |                 |                |         |
|                          | Managed PostgreSQL          | Yes         | Yes     | Yes    | Yes (unmanaged) | Yes            | Yes     |
|                          | Managed MySQL               | Yes         | Yes     | No     | No              | Yes            | Yes     |
|                          | Managed Redis               | Yes         | Yes     | Yes    | No              | Yes            | Yes     |
|                          | Managed MongoDB             | Yes         | Yes     | No     | No              | Yes            | Yes     |
|                          | Read Replicas               | **No**      | Yes     | Yes    | Manual          | Yes            | Yes     |
|                          | Point-in-Time Recovery      | **No**      | Yes     | Yes    | Manual          | Yes            | Yes     |
|                          | Automated Backups           | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Credential Rotation         | Yes         | No      | No     | No              | No             | No      |
|                          | Database Browser/Query Tool | Yes         | No      | No     | No              | No             | No      |
| **Observability**        |                             |             |         |        |                 |                |         |
|                          | Metrics Collection          | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Alerting                    | Yes         | No      | No     | No              | No             | Basic   |
|                          | Log Streaming               | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Log Search                  | Partial     | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Distributed Tracing         | **No**      | No      | No     | No              | No             | No      |
|                          | APM                         | **No**      | No      | No     | No              | Yes            | No      |
|                          | Status Page                 | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
| **Scaling**              |                             |             |         |        |                 |                |         |
|                          | Horizontal Autoscaling      | Yes\*       | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Vertical Scaling            | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Placement Strategies        | Yes (3)     | No      | No     | Yes             | No             | No      |
|                          | Scale-to-Zero               | **No**      | Yes     | No     | Yes             | No             | No      |
|                          | Predictive Scaling          | **No**      | No      | No     | No              | No             | No      |
| **Security**             |                             |             |         |        |                 |                |         |
|                          | Team-based RBAC             | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | API Tokens with Scoping     | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Audit Logging               | Yes         | No      | No     | No              | No             | No      |
|                          | SSH Key Management          | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Secret Management           | Yes         | Yes     | No     | Yes             | Yes            | Yes     |
|                          | Rate Limiting               | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | 2FA / MFA                   | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
| **Developer Experience** |                             |             |         |        |                 |                |         |
|                          | Web UI Dashboard            | Yes         | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | CLI Tool                    | Basic (5)   | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Terraform Provider          | **No**      | No      | No     | Yes             | Yes            | Yes     |
|                          | GitHub Actions              | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | OpenAPI Documentation       | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | API Client Libraries        | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
| **Business**             |                             |             |         |        |                 |                |         |
|                          | Billing & Metering          | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Resource Quotas             | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Plan Tiers                  | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |
|                          | Usage Dashboards            | **No**      | Yes     | Yes    | Yes             | Yes            | Yes     |

\*Current autoscaling has significant limitations (see Part 4)

### D.2 Score Summary

| Platform          | Score (out of 75 features) | Percentage |
| ----------------- | -------------------------- | ---------- |
| **Nixway Core**   | **42 / 75**                | **56%**    |
| Railway           | 58 / 75                    | 77%        |
| Render            | 59 / 75                    | 79%        |
| Fly.io            | 56 / 75                    | 75%        |
| Heroku            | 58 / 75                    | 77%        |
| DigitalOcean Apps | 60 / 75                    | 80%        |

### D.3 Nixway's Unique Strengths (Not commonly found)

- **Credential Rotation for Databases** - Automated with linked app restart
- **Database Query Tooling** - Browser, query runner, Redis/Mongo inspectors
- **WireGuard Mesh Networking** - Full mesh with DNS
- **Placement Strategies** - Spread, binpack, pinned with tag constraints
- **Traffic Weight Management** - Weighted backend promotion
- **Audit Logging** - Comprehensive operation audit trail
- **WebSocket Terminal** - Server + container terminal access
- **Autoscaling Foundation** - Evaluation loop (needs significant improvement)
- **Secret Versioning** - Versioned secrets with access logging
- **SSH Key Management** - Encrypted key storage and generation

### D.4 Nixway's Critical Weaknesses (Blockers for commercial use)

- **No Billing System** - Cannot charge customers
- **No Rate Limiting** - API is vulnerable to abuse
- **No Resource Quotas** - No resource isolation between teams
- **No Preview Environments** - Expected by modern development teams
- **No Background Workers** - Cannot run async jobs
- **No Cron Jobs** - Cannot run scheduled tasks
- **Minimal CLI** - 5 commands vs 100+ for competitors
- **No Log Search** - Operational debugging is difficult
- **No Health Check Customization** - One-size-fits-all approach
- **No Multi-Region** - Single-region deployment only
- **Broken Auto-Scaling** - Full redeploy on scale, wrong metrics

## Document Summary

### Key Metrics

| Metric                           | Value                      |
| -------------------------------- | -------------------------- |
| Total Agent Analyses Synthesized | 19                         |
| Platform Maturity Score          | 6.5/10                     |
| Critical Issues (P0)             | 14                         |
| Important Issues (P1)            | 26                         |
| Nice-to-Have (P2)                | 14                         |
| Future (P3)                      | 7                          |
| Total API Endpoints              | ~155                       |
| Database Tables                  | 60+                        |
| UI Components                    | ~50 shadcn/ui + ~40 custom |
| User Workflows Documented        | 32                         |
| Estimated Effort to Launch       | 50-65 weeks (P0)           |
| Competitive Feature Score        | 56%                        |

### Recommended Next Steps

- **Week 1-2:** Begin auto-scaling engine redesign (highest impact)
- **Week 1-2:** Implement API rate limiting (security critical)
- **Week 1-2:** Set up Next.js 15 project for frontend migration
- **Week 3-4:** Implement resource quotas
- **Week 3-6:** Continue auto-scaling redesign (all phases)
- **Month 2:** Begin billing system design and implementation
- **Month 2-3:** Continue frontend migration
- **Month 3:** Preview environments, pipeline stages, cron jobs
- **Month 4-6:** Complete remaining P0 items

### Success Criteria for Commercial Launch

- ☐ Auto-scaling engine v2 deployed and stable
- ☐ API rate limiting active on all endpoints
- ☐ Resource quotas enforced per team
- ☐ Billing system collecting usage data
- ☐ Plan tiers (Free/Hobby/Pro) configured
- ☐ Frontend migrated to Next.js 15
- ☐ Health checks customizable per app
- ☐ Preview environments working
- ☐ Pipeline stages with gates operational
- ☐ Cron jobs and background workers available
- ☐ Log aggregation with search functional
- ☐ Enhanced CLI with deploy/logs/env commands
- ☐ SSL certificate management complete

_This document was synthesized from 19 specialist agent analyses covering authentication, frontend architecture, backend API, database design, deployment pipeline, scheduling, auto-scaling, observability, cluster mesh networking, managed database services, security, infrastructure, frontend migration planning, component system migration, page inventory, UI/UX design system, auto-scaling engine redesign, complete workflow specifications, and competitive gap analysis._

_Last Updated: January 2026_
