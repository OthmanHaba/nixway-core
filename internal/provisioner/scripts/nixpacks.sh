#!/bin/bash
set -euo pipefail
echo "=== Installing Nixpacks ==="
curl -fsSL https://nixpacks.com/install.sh | bash
echo "=== Nixpacks installed: $(nixpacks --version) ==="
