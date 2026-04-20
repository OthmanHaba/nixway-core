#!/bin/bash
set -euo pipefail
echo "=== Installing Traefik ==="

mkdir -p /etc/traefik /etc/traefik/dynamic

# Create nixway network if not exists
docker network create nixway 2>/dev/null || true

cat > /etc/traefik/traefik.yml <<'CONFIG'
api:
  dashboard: false
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: nixway
  file:
    directory: "/etc/traefik/dynamic"
    watch: true
certificatesResolvers:
  letsencrypt:
    acme:
      email: admin@nixway.dev
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web
CONFIG

docker pull traefik:latest
docker rm -f traefik 2>/dev/null || true
docker run -d --name traefik --restart=always \
  --network nixway \
  -p 80:80 -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/traefik:/etc/traefik \
  -e DOCKER_API_VERSION=1.45 \
  traefik:latest

echo "=== Traefik installed ==="
