#!/bin/bash
set -euo pipefail
echo "=== Installing Traefik ==="

mkdir -p /etc/traefik /etc/traefik/dynamic

cat > /etc/traefik/traefik.yml <<'CONFIG'
api:
  dashboard: false
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
  websecure:
    address: ":443"
providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
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

docker pull traefik:v3.3
docker rm -f traefik 2>/dev/null || true
docker run -d --name traefik --restart=always \
  -p 80:80 -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/traefik:/etc/traefik \
  traefik:v3.3

echo "=== Traefik installed ==="
