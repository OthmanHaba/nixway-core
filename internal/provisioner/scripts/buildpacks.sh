#!/bin/bash
set -euo pipefail
echo "=== Installing Cloud Native Buildpacks (pack CLI) ==="

ARCH=$(uname -m)
PACK_VERSION=$(curl -s https://api.github.com/repos/buildpacks/pack/releases/latest | grep tag_name | cut -d '"' -f 4)

# x86_64 uses "linux.tgz", other arches use "linux-{arch}.tgz"
case $ARCH in
  x86_64)  SUFFIX="linux" ;;
  aarch64) SUFFIX="linux-arm64" ;;
  *)       SUFFIX="linux-${ARCH}" ;;
esac

curl -fsSL "https://github.com/buildpacks/pack/releases/download/${PACK_VERSION}/pack-${PACK_VERSION}-${SUFFIX}.tgz" | tar xz -C /usr/local/bin

pack config default-builder heroku/builder:24

echo "=== Pack CLI installed: $(pack --version) ==="
