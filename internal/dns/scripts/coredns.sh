#!/bin/bash
set -euo pipefail
echo "=== Deploying CoreDNS ==="

COREDNS_DIR="/etc/coredns"
mkdir -p "$COREDNS_DIR"

# Corefile and hosts file are written by the agent before this script runs

docker pull coredns/coredns:1.11

docker rm -f nixway-coredns 2>/dev/null || true

# Get the WireGuard IP for binding
WG_IP=$(ip -4 addr show wg0 | grep -oP '(?<=inet\s)\d+(\.\d+){3}')

docker run -d --name nixway-coredns --restart=always \
  --network host \
  -v /etc/coredns:/etc/coredns:ro \
  coredns/coredns:1.11 \
  -conf /etc/coredns/Corefile

# Update resolv.conf to use local CoreDNS
if ! grep -q "$WG_IP" /etc/resolv.conf; then
  sed -i "1i nameserver $WG_IP" /etc/resolv.conf
fi

echo "=== CoreDNS deployed, listening on $WG_IP:53 ==="
