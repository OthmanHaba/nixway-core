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
curl --http1.1 -fsSL "${API_URL}/agent/download/${ARCH}" -o /tmp/nixway-agent
chmod +x /tmp/nixway-agent
mv /tmp/nixway-agent /usr/local/bin/nixway-agent
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
systemctl start nixway-agent

echo "=== Nixway Agent installed and started ==="
