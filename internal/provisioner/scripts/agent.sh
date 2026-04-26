#!/bin/bash
set -euo pipefail
echo "=== Installing Nixway Agent ==="

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
  *)
    echo "ERROR: unsupported architecture: $ARCH"
    exit 1
    ;;
esac

API_URL="__API_URL__"
GRPC_ADDR="__GRPC_ADDR__"
SERVER_ID="__SERVER_ID__"

echo "Downloading agent for $ARCH..."
TMP_AGENT="$(mktemp /tmp/nixway-agent.XXXXXX)"
cleanup() {
  rm -f "$TMP_AGENT"
}
trap cleanup EXIT

if [ -s /tmp/nixway-agent-uploaded ]; then
  echo "Using agent binary uploaded over SSH"
  install -m 0755 /tmp/nixway-agent-uploaded /usr/local/bin/nixway-agent
else
  CURL_OPTS=(--http1.1 --fail --location --show-error --continue-at - --retry 5 --retry-delay 2 --retry-connrefused)
  if curl --help all 2>/dev/null | grep -q -- '--retry-all-errors'; then
    CURL_OPTS+=(--retry-all-errors)
  fi

  echo "Download URL: ${API_URL}/agent/download/${ARCH}"
  curl "${CURL_OPTS[@]}" "${API_URL}/agent/download/${ARCH}" -o "$TMP_AGENT"
  if [ ! -s "$TMP_AGENT" ]; then
    echo "ERROR: downloaded agent binary is empty"
    exit 1
  fi
  install -m 0755 "$TMP_AGENT" /usr/local/bin/nixway-agent
fi

echo "Installed to /usr/local/bin/nixway-agent"

cat > /etc/systemd/system/nixway-agent.service <<EOF
[Unit]
Description=Nixway Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/local/bin/nixway-agent --server ${GRPC_ADDR} --id ${SERVER_ID}
Restart=always
RestartSec=5
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nixway-agent
systemctl restart nixway-agent

echo "=== Nixway Agent installed and started ==="
