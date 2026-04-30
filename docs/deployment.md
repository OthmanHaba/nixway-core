# Nixway Deployment

## Simple Deploy

```bash
make deploy
```

For a public server, set your domain. This enables Traefik, configures HTTPS, and makes Nixway available at `https://<domain>`:

```bash
NIXWAY_PUBLIC_DOMAIN=nixway.example.com NIXWAY_TRAEFIK_ACME_EMAIL=admin@example.com make deploy
```

The deploy command is idempotent. It creates or updates `.env`, generates `NIXWAY_CRYPTO_MASTER_KEY` when missing, builds the containers, starts infrastructure services, runs SQL migrations, and starts the API, worker, and web UI. When `NIXWAY_PUBLIC_DOMAIN` is set, it also starts Traefik.

## What Runs In Docker

| Service | Image/build | Purpose |
| --- | --- | --- |
| `web` | `apps/web/Dockerfile` | React/Vite static UI served by Nginx; proxies `/api` and WebSocket/SSE traffic to the API. |
| `traefik` | `traefik:v3` | Optional HTTPS reverse proxy, enabled by `NIXWAY_PUBLIC_DOMAIN`. |
| `api` | root `Dockerfile` target `api` | Go HTTP API plus agent gRPC control plane. Includes Linux agent binaries for `/agent/download/{arch}`. |
| `worker` | root `Dockerfile` target `worker` | River background worker for async jobs and email work. |
| `migrate` | root `Dockerfile` target `migrate` | One-shot goose migration runner for `sql/migrations`. |
| `postgres` | `postgres:16-alpine` | Primary Nixway database. |
| `redis` | `redis:7-alpine` | Sessions, job coordination, and runtime events. |
| `victoria-metrics` | `victoriametrics/victoria-metrics` | Metrics storage. |
| `vmagent` | `victoriametrics/vmagent` | Prometheus scrape/remote-write agent. |
| `minio` | `minio/minio` | S3-compatible platform storage for backups. |

## Exposed Ports

| Host port | Container | Use |
| --- | --- | --- |
| `80` | `traefik:80` | HTTP entrypoint and Let's Encrypt HTTP challenge when Traefik is enabled. |
| `443` | `traefik:443` | HTTPS web UI/API domain when Traefik is enabled. |
| `5173` | `web:80` | Web UI. |
| `8080` | `api:8080` | HTTP API, health check, webhooks, and agent binary downloads. |
| `9090` | `api:9090` | Agent gRPC control plane. Must be reachable by provisioned agents. |
| `127.0.0.1:5432` | `postgres:5432` | Local database access only. |
| `127.0.0.1:6379` | `redis:6379` | Local Redis access only. |
| `8428` | `victoria-metrics:8428` | VictoriaMetrics HTTP API. |
| `8429` | `vmagent:8429` | vmagent HTTP/debug endpoint. |
| `9000` | `minio:9000` | MinIO S3 API. |
| `9001` | `minio:9001` | MinIO console. |

Host ports can be changed in `.env` with `NIXWAY_WEB_PORT`, `NIXWAY_API_PORT`, `NIXWAY_GRPC_PORT`, `NIXWAY_HTTP_PORT`, and `NIXWAY_HTTPS_PORT`. The API container listens on the same gRPC port that is published to the host so provisioned agents receive the correct address.

With Traefik enabled, public traffic should use:

```text
https://<NIXWAY_PUBLIC_DOMAIN>
```

Traefik routes `/api/*` and `/agent/*` to the API container, and all other UI traffic to the web container.

## Agent-Related Environment

The deploy script ensures these values are present in `.env`:

```bash
NIXWAY_PUBLIC_DOMAIN=
NIXWAY_TRAEFIK_ACME_EMAIL=
NIXWAY_SERVER_PUBLIC_URL=http://localhost:8080
NIXWAY_SERVER_GRPC_PORT=9090
NIXWAY_SERVER_AGENT_BINARY_DIR=/app/agent/bin
```

When `NIXWAY_PUBLIC_DOMAIN` is set, the deploy script sets `NIXWAY_SERVER_PUBLIC_URL=https://<domain>` unless you explicitly override it. The API derives the public gRPC endpoint for agents from that host plus `NIXWAY_SERVER_GRPC_PORT`.
