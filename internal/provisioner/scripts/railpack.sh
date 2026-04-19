#!/bin/bash
set -euo pipefail
echo "=== Installing Railpack ==="
curl -fsSL https://railpack.com/install.sh | bash
echo "=== Railpack installed: $(railpack --version) ==="
