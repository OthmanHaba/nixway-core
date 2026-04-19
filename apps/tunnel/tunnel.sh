#!/bin/bash
# Starts a cloudflared quick tunnel exposing the API server (port 8080)
# The tunnel URL is printed to stdout and saved to .tunnel-url for other tools to read

set -euo pipefail

PORT="${NIXWAY_API_PORT:-8080}"
URL_FILE="$(dirname "$0")/../../.tunnel-url"

echo "Starting cloudflared tunnel for localhost:${PORT}..."
echo "Tunnel URL will be printed below and saved to .tunnel-url"
echo ""

# Run cloudflared and capture the URL
cloudflared tunnel --url "http://localhost:${PORT}" 2>&1 | while read -r line; do
  echo "$line"
  # Capture the tunnel URL when cloudflared prints it
  if echo "$line" | grep -qo 'https://[a-z0-9-]*\.trycloudflare\.com'; then
    url=$(echo "$line" | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com')
    echo "$url" > "$URL_FILE"
    echo ""
    echo "=========================================="
    echo "  TUNNEL URL: $url"
    echo "=========================================="
    echo ""
    echo "Set this in your agent installer or config:"
    echo "  export NIXWAY_API_URL=$url"
    echo ""
  fi
done
