#!/bin/bash
# Sets up an SSH reverse tunnel so the remote agent can reach
# the local gRPC server (port 9090) via localhost:9090 on the server.
#
# Usage: bash apps/tunnel/grpc-tunnel.sh <server-ip> [ssh-user] [ssh-key]
#
# Example:
#   bash apps/tunnel/grpc-tunnel.sh 3.120.50.10
#   bash apps/tunnel/grpc-tunnel.sh 3.120.50.10 ubuntu ~/.ssh/id_rsa

set -euo pipefail

SERVER_IP="${1:?Usage: grpc-tunnel.sh <server-ip> [ssh-user] [ssh-key]}"
SSH_USER="${2:-ubuntu}"
SSH_KEY="${3:-}"
GRPC_PORT="${NIXWAY_GRPC_PORT:-9090}"

KEY_OPT=""
if [ -n "$SSH_KEY" ]; then
  KEY_OPT="-i $SSH_KEY"
fi

echo "Setting up SSH reverse tunnel:"
echo "  Remote ${SERVER_IP}:${GRPC_PORT} -> Local localhost:${GRPC_PORT}"
echo "  Press Ctrl+C to stop"
echo ""

# -R: reverse tunnel — remote port forwards to local port
# -N: no remote command
# -o ServerAliveInterval: keep connection alive
# -o ExitOnForwardFailure: fail if port already in use
ssh -R ${GRPC_PORT}:localhost:${GRPC_PORT} \
    -N \
    -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 \
    -o ExitOnForwardFailure=yes \
    ${KEY_OPT} \
    ${SSH_USER}@${SERVER_IP}
