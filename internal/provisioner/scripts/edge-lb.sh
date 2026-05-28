#!/bin/bash
set -euo pipefail
echo "=== Installing edge-lb (Traefik on host network, file provider only) ==="

# This is the dedicated front-of-cluster LB. Unlike the per-node `traefik`
# component, it runs with `--network host` so Traefik can reach worker
# replicas at their WireGuard mesh IPs (the WG interface is host-level,
# not visible inside Docker bridge networks). The Docker provider is left
# out on purpose — the edge node typically runs no app containers, and
# the file provider receives its whole config from the control plane.

mkdir -p /etc/traefik /etc/traefik/dynamic
touch /etc/traefik/acme.json
chmod 600 /etc/traefik/acme.json

cat > /etc/traefik/traefik.yml <<'CONFIG'
api:
  dashboard: false
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
providers:
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
log:
  level: INFO
accessLog: {}
CONFIG

docker pull traefik:latest
docker rm -f traefik 2>/dev/null || true
docker run -d --name traefik --restart=always \
  --network host \
  -v /etc/traefik:/etc/traefik \
  traefik:latest

echo "=== edge-lb installed (host network, ports 80/443) ==="
