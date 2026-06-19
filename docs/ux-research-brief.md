# Nixway — UX Research & Design Brief

**Audience:** UI/UX researcher and product designer joining the Nixway team
**Goal:** Research user needs, propose UX improvements, and design screens for the Nixway control plane web UI
**Status of platform:** Phases 0–5 backend complete; web UI exists for most flows but has not been designed by a specialist
**Read time:** ~20 minutes

---

## 1. What is Nixway?

Nixway is a **self-hostable Platform-as-a-Service (PaaS)** in the same category as Coolify, CapRover, Render, Railway, and Heroku. A user connects their own Linux servers (their cloud, their bare metal), and Nixway turns that pool of servers into a managed runtime that can build code from GitHub, deploy containers, manage databases, route traffic, monitor logs, and scale.

The user owns the infrastructure. Nixway owns the workflow.

### Core promise to the end user
> "Bring your own servers. Push to GitHub. Get a live HTTPS URL. Manage everything from one console."

### Architectural shape (researcher does not need to know all detail, only the surface)
- **Control plane** — Web UI + API the user logs into (this is what we are designing)
- **Agent** — small binary installed on each user server; talks back to the control plane over a secure tunnel
- **Cluster** — group of user servers wired into a private WireGuard mesh with internal DNS
- **Project** — a logical grouping (an "app on the platform") containing one or more deployable services
- **App / Service** — a single deployable unit (a web service, a worker, a cron job, a database)

---

## 2. Who uses Nixway?

We have not run formal interviews yet — **establishing real personas is part of the researcher's job.** The hypotheses below are starting points to challenge, not conclusions.

### Hypothesized primary personas

**P1 — The Indie Developer / Solo Founder**
- Runs 1–10 side projects or a small SaaS
- Comfortable in a terminal but does not want to manage Kubernetes
- Wants: cheap, fast, "git push to deploy", custom domains, a database that just works
- Pain today: Heroku is expensive, Vercel does not run their Postgres, Coolify UI feels rough

**P2 — The Small Engineering Team Lead (3–15 engineers)**
- Owns infra for a startup
- Needs: per-environment secrets, multiple environments per project, RBAC, audit log, observability, rollbacks, custom domains with TLS
- Pain today: building this themselves on raw EC2 is months of work; managed PaaS gets expensive past a few apps

**P3 — The Platform / DevOps Engineer at a mid-size company**
- Wants self-hosted control over data and cost
- Needs: clusters across regions, autoscaling, blue/green/canary, SSO, fine-grained RBAC, quotas, metering
- Pain today: Kubernetes is overkill, internal platforms are a year of work

### What we want the researcher to find out
- Are these the right personas? Who else?
- What is each persona's first 5 minutes? First day? First week?
- Where do current PaaS tools (Coolify, CapRover, Railway, Render, Vercel, Fly, Dokku, Heroku) win and lose for them?
- What "moments of magic" earn loyalty? What "moments of friction" cause churn?
- What language do they actually use? (We say "cluster" and "app" — do they?)

---

## 3. End-to-end functional surface

This is the full shape of the product. Each section is a candidate area for screens.

### A. Authentication & accounts
Signup, login, email verification, password reset, sessions. Future: SSO (SAML/OIDC), 2FA.

### B. Teams & access control
- Create team, invite members, accept invite
- Roles: owner, admin, member (more granular roles coming)
- API tokens with scopes
- Audit log of every meaningful action

### C. Servers (the user's own machines)
- Add a server: enter hostname/IP, SSH credentials, choose what to install
- Auto-provision: install Docker, Traefik, Nixpacks, buildpacks
- See live install logs streaming
- Server detail: status (online/degraded/offline), CPU/RAM/disk usage, kernel + Docker versions, tags
- Open an **SSH terminal** to the server inside the browser
- Manage SSH keys (generate, upload, rotate, delete)
- Tag servers (`env=prod`, `role=builder`, etc.) for placement rules later
- Server-level syslog viewer (live `journalctl` stream by unit)

### D. Clusters & private networking
- Create a cluster, attach servers to it
- Cluster gets a private CIDR (e.g. `10.100.5.0/16`)
- Servers auto-join a WireGuard mesh, every server can reach every other server privately
- Internal DNS: `serverA.mycluster.internal` resolves inside the mesh
- Cluster detail: member list, **N×N mesh health matrix** (which links are healthy), event log

### E. Integrations
- **GitHub App** — user creates and installs a GitHub App, picks which repos Nixway can see
- **Container registry credentials** — Docker Hub, GHCR, ECR, generic OCI
- **Secrets store** — encrypted, scoped per environment, **reveal-once** values, audit on every access

### F. Projects & apps (the heart of the product)
- Project lives inside a cluster, contains environments (production auto-created, plus user-defined)
- App sources: **GitHub repo + branch** OR **Docker image + tag**
- Auto-discovery proposes a builder (Dockerfile, Nixpacks, buildpacks, Railpack); user can override
- Configure: domain, port, health check, resource limits (CPU + memory), env vars, secrets, replicas
- **Auto-deploy on push** (when source is a GitHub repo)

### G. Builds
- Triggered by push, manual button, or API
- Phases: clone → detect builder → build → push image
- **Live streaming build logs** in browser
- Build history per app, with status, duration, commit SHA, who triggered

### H. Deployments
- Triggered by a successful build, manual redeploy, or rollback
- Rolling deploy across cluster servers
- Per-target status (which server got which replica, healthy or not)
- **Live deploy logs** + history with one-click rollback

### I. Routing & domains
- Every app gets a free wildcard subdomain (e.g. `myapp-myproject-myteam.apps.nixway.dev`)
- Custom domains: user adds domain → platform shows DNS target → user updates DNS → platform issues TLS via Let's Encrypt
- Future: wildcard custom domains via DNS-01

### J. Runtime operations (live containers)
- Per-app **replicas list** — see each running container, which server it is on, its status
- **Restart / stop** a single replica or the whole app
- **Inspect** — image digest, env vars (secrets masked as `SECRET_REF:<name>`), labels, mounts, restart count, last exit code
- **Edit resource limits** (CPU + memory) — triggers rolling restart
- **Web terminal into a running container**, picking which replica to attach to
- **Live log tail** across all replicas, color-coded per replica
- **Historical log search** — full-text search across the last 7 days (configurable retention)

### K. Databases & volumes (Phase 8 — being designed now)
- Provision Postgres / MySQL / Mongo / Redis / RabbitMQ / MinIO / Meilisearch from a template
- Pick version from dropdown, pick placement (specific server / dedicated / let scheduler decide), pick resources, pick backup policy
- Generated credentials shown **once**, then stored as secrets
- DB reachable via private DNS: `mydb.myproject.mycluster.internal`
- **Link a DB to an app** → injects `DATABASE_URL` and friends automatically
- DB tooling in browser:
  - Terminal directly into `psql` / `mysql` / `mongosh` / `redis-cli`
  - **Table browser** with paginated rows, sortable columns, readonly by default
  - **Query runner** with history and saved queries
  - **Redis inspector** (keys, TTL, type-aware viewers, live `INFO`)
- Volume lifecycle: create, attach, detach, snapshot, resize, move between servers, delete

### L. Scaling & load balancing (Phase 6)
- Set replica count manually
- Placement strategies: spread / binpack / pinned
- **Autoscaling rules** — `metric > threshold for duration → +N replicas` with min/max bounds and cooldowns
- Scaling event timeline
- Weighted routing (50/50, etc.)

### M. Observability (Phase 7)
- Four dashboard levels: **server, container, project, cluster**
- Realtime view (last 5 min, 15s refresh) and historical view (1h / 24h / 7d / 30d)
- Alert rules with severity, channels (email, Slack, Discord, webhook), silence/snooze, state tracking

### N. Advanced (Phase 9)
- **Preview environments per pull request** with auto-comment of preview URL
- **Cron jobs** with run history and concurrency policy
- **Background workers** (no routing, just supervised restart)
- **Blue/green & canary** deploys with traffic splitting
- **Service-to-service discovery** UI surfacing internal DNS names
- **Cost attribution** per project / cluster

### O. Hardening & enterprise (Phase 10)
- SSO (SAML, OIDC), SCIM
- Custom RBAC roles with permission catalog
- Quotas (max servers/clusters/projects/CPU/RAM/storage)
- Rate limiting, usage metering, billing hooks
- Platform backup/DR, agent auto-upgrade

---

## 4. Today's UI — what exists, what is rough

The web app is built in **React + TanStack Router + TanStack Query + Tailwind**. Code lives in `apps/web/`. Existing routes:

| Route | Purpose | Maturity |
|---|---|---|
| `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` | Auth | Functional, generic |
| `/dashboard` | Landing after login | Placeholder |
| `/teams`, `/teams/:id`, `/teams/:id/settings`, `/teams/:id/tokens`, `/teams/:id/audit-log` | Team mgmt | Functional, plain |
| `/servers/:teamId` | Server list | Functional, status badges, tag filter |
| `/servers/:teamId/:serverId` | Server detail (Overview / Resources / Terminal / Logs) | Functional with charts + xterm.js |
| `/ssh-keys/:teamId` | SSH key mgmt | Functional, plain |
| `/clusters/:teamId`, `/clusters/:teamId/:clusterId` | Cluster list + detail (mesh matrix) | Functional, needs polish |
| `/projects/:teamId`, `/projects/:teamId/:projectId` | Project list + detail | Functional |
| `/apps/:appId` | App detail (builds, deploys, replicas, terminal, logs, inspect, resources) | Functional, **dense, needs IA work** |
| `/databases/:teamId/:projectId`, `/databases/:teamId/detail/:databaseId` | DB list + detail | Early |
| `/volumes/:teamId` | Volumes | Early |
| `/settings/:teamId` | Settings | Placeholder |
| `/github/callback` | GitHub App OAuth callback | Functional |

### Honest UI assessment from the engineering side
- Built by an engineer optimizing for "does it work", not for "is it learnable"
- **No design system** beyond raw shadcn/ui defaults
- **Information architecture is ad-hoc** — `/apps/:appId` packs builds, deploys, runtime, inspect, logs, resources, terminal into one screen with tabs and it's becoming overwhelming
- **No empty states designed** — first-run shows a blank list with a "+ Add" button
- **No onboarding flow** — a new user lands on `/dashboard` (placeholder) and has to figure out: add SSH key → add server → wait for provisioning → create cluster → attach server → connect GitHub → create project → create app → wait for build → wait for deploy. That is a 10-step cliff.
- **Status/streaming UX is inconsistent** — provisioning logs, build logs, deploy logs, container logs, server syslog all stream live but are styled and laid out differently
- **No mental model surfaced** — users have to internalize team→cluster→project→environment→app→replica without any visual anchor
- Terminal and log views look different in every screen they appear

---

## 5. The design questions we need answered

Group A — **mental model & navigation**
1. What is the right primary navigation? Today: top-level Teams / Servers / Clusters / Projects / Databases / Volumes. Is that the right grouping for a real user's workflow, or does it map to our schema not their job?
2. How do we surface the team→cluster→project→environment→app→replica hierarchy without it feeling like a file tree?
3. Where does **search** belong — global, per-resource, or both?

Group B — **first-run & onboarding**
1. What is the **shortest path to first deployed app** and what should it actually look like in the UI?
2. Should we collapse "add server → create cluster → connect GitHub → create project → create app" into a single guided flow for new users, with the granular pages still available for power users?
3. Sample-app / template-deploy "magic moment" — should we have a "Deploy a sample Node.js app on this server in 60 seconds" flow?

Group C — **the App detail screen**
This is the densest, most-used screen. It currently bundles: live status, builds list, deploys list, replicas list, terminal, log tail, log search, inspect, resource limits editor, settings, env vars, domains, secrets links.
1. What is the right primary view when a user opens an app — last deploy status? Live logs? A summary?
2. Tabs, side nav, accordion, separate sub-routes — what fits best for ~10 sub-areas?
3. How do we make "this app is healthy / degraded / failing" obvious in 0.5 seconds?

Group D — **streaming & realtime UX**
1. Provisioning logs, build logs, deploy logs, container logs, server syslog — should they share one component / pattern? What does that pattern look like (ANSI colors? virtualized scroller? follow-tail toggle? download? share-link?)
2. How do we communicate "I am connected and tailing live" vs "I am viewing a paused snapshot"?
3. The mesh health matrix (N×N grid of WireGuard link status) — what is the readable design for 3, 10, 50 nodes?

Group E — **destructive & sensitive actions**
1. Reveal-once secrets — what does the "you can only see this once" UI look like so users don't lose it?
2. Database deletion, volume deletion, cluster deletion, server removal with cleanup — what is the right confirmation pattern (typed name? two-step? cooldown?)
3. Rolling restart vs hard stop, rollback vs redeploy — how do we make the difference legible?

Group F — **observability & data density (Phase 7 design)**
1. Four dashboard levels (server / container / project / cluster) — same component, different scope, or different shapes?
2. How do we make a 30-day historical query feel as fluid as a 5-minute realtime view?
3. Alert rule editor — wizard, form, or DSL? For a metric + threshold + duration + channel + cooldown, what is the least-friction design?

Group G — **information density tradeoffs**
1. We are building a power-user tool. Most reference designs (Vercel, Render) optimize for a different audience. Where do we lean dense (Linear, Datadog, GitHub) vs spacious?
2. Dark mode is the default for dev tools — but what about light mode parity?
3. Keyboard navigation — what do power users expect? (cmd-K palette, j/k navigation, etc.)

Group H — **trust & status**
1. What does the "system is healthy" baseline state look like? When everything is green and nothing is happening, what is on screen?
2. Real-world incidents (server offline, mesh degraded, build failing, deploy stuck, DB out of disk) — how do we surface them so the user notices without being spammed?

---

## 6. Competitive landscape — please study

Bench these products, screen-by-screen, and report what to steal and what to avoid:

**Direct competitors (self-hosted PaaS)**
- Coolify (https://coolify.io)
- CapRover (https://caprover.com)
- Dokploy (https://dokploy.com)
- Dokku (https://dokku.com)

**Managed PaaS (the bar for polish)**
- Vercel
- Render
- Railway
- Fly.io
- Heroku (still the gold standard for some flows)

**Adjacent inspirations (great UX in dense tooling)**
- Linear (information density done right)
- GitHub (PRs, Actions, Codespaces UI)
- Supabase (DB tooling in browser — directly relevant to Phase 8)
- Cloudflare dashboard (multi-resource console)
- Datadog (observability density)
- Grafana (dashboards & alerts)
- Tailscale admin console (mesh networking UX — directly relevant to Phase 2)

For each, capture: **navigation model, first-run, app-detail, logs, deploy flow, settings/secrets, dark/light, empty states.**

---

## 7. Suggested research deliverables

We do not want a 60-page report. We want **decisions we can build from.** Suggested artifacts, in order of usefulness:

1. **Persona doc (2–4 personas, 1 page each)** — with quotes if you can interview real users in the indie/startup dev community
2. **Competitive teardown (10 products × 8 surfaces)** as a Figma board or Notion table, with our pick of "best in class" per surface and why
3. **Information architecture proposal** — sitemap of the entire UI with the new navigation model
4. **Onboarding flow** — wireframes for first-run, end to end, until first deployed app
5. **Design system foundation** — type scale, color, spacing, density, dark/light tokens, component primitives (status badge, log viewer, terminal, table, form, modal, confirm dialog)
6. **High-fidelity designs for the 10 most important screens** (proposed list, ranked):
   1. Dashboard / home (post-login)
   2. App detail (the dense one)
   3. Build & deploy live view
   4. Logs (live + historical search)
   5. In-browser terminal (server SSH and container exec)
   6. Cluster detail with mesh health
   7. Database detail with table browser + query runner
   8. New project / new app wizard
   9. Secrets & env vars editor
   10. Server provisioning live view
7. **Interaction prototypes** for the 3 highest-stakes flows: add-server-through-first-deploy, rollback-during-incident, provision-database-and-link-to-app

---

## 8. Constraints & non-goals

- **Self-hosted by default.** Designs cannot assume Nixway-managed infra. The user's own servers are the truth.
- **No mobile-first.** This is a desktop console. Responsive is nice; mobile parity is not a goal.
- **Keep technical accuracy.** Do not invent abstractions that don't map to what the platform does. If something is called a "cluster" in the API, do not rename it to "environment" in the UI without a strong reason.
- **No vendor lock-in language.** The user owns their servers, their domains, their data. Tone should reinforce that.
- **No AI-generated stock illustrations** for empty states. Use concrete, functional imagery or none at all.
- **Do not redesign the marketing site.** This brief is for the **logged-in product**.

---

## 9. Engineering context the designer should know

- Stack: **React + TanStack Router + TanStack Query + Tailwind + shadcn/ui** (radix primitives). Designers can produce Figma; we will translate to shadcn-compatible components.
- Realtime data is **first-class**: heartbeats, log streams, build/deploy progress, mesh health all push live. Designs should plan for live-updating components, not request/response only.
- We use **xterm.js** for terminal, **recharts** for charts. Replacing these is possible but expensive — propose alternatives only with strong reason.
- Backend is RESTful JSON over HTTPS, with **SSE** for log streaming and **WebSocket** for terminal. The UI does not need to know more than that.
- The platform is being shipped phase-by-phase. **Phases 0–5 are live.** Designs for Phases 6–10 are welcome but the priority is bringing 0–5 up to a high bar first.

---

## 10. Working agreement (proposal — let's discuss)

- **Week 1–2:** persona interviews, competitive teardown, IA proposal
- **Week 3:** design system foundation + dashboard + IA review with engineering
- **Week 4–6:** the 10 priority screens, reviewed two at a time
- **Week 7+:** prototypes, usability tests, iteration

Reviews are async-friendly. Engineering will provide a staging URL of the current UI and a read-only API token so the designer can poke at real data shapes.

---

## 11. How to ask questions

- The platform spec, phase by phase, lives at `app-phases.md` in this repo (it is the single source of truth — read it).
- Engineering questions: open a thread in the team channel; tag the engineer who built the relevant phase.
- For "why does it work this way" questions about a feature, the spec usually has the answer in the relevant phase's **Technical Specifics** section.

---

**Thank you for joining. The platform works. Now help us make it feel like it deserves to.**
