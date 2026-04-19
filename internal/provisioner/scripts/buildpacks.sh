#!/bin/bash
set -euo pipefail
echo "=== Installing Cloud Native Buildpacks (pack CLI) ==="

ARCH=$(uname -m)
case $ARCH in
  x86_64) ARCH="amd64" ;;
  aarch64) ARCH="arm64" ;;
esac

PACK_VERSION=$(curl -s https://api.github.com/repos/buildpacks/pack/releases/latest | grep tag_name | cut -d '"' -f 4)
curl -fsSL "https://github.com/buildpacks/pack/releases/download/${PACK_VERSION}/pack-${PACK_VERSION}-linux-${ARCH}.tgz" | tar xz -C /usr/local/bin

pack config default-builder heroku/builder:24

echo "=== Pack CLI installed: $(pack --version) ==="
