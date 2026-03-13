#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "=== Building golden image ==="
docker build \
  -f "$REPO_ROOT/packages/agent-runtime/container/Dockerfile.base" \
  -t mediforce-golden-image \
  "$REPO_ROOT/packages/agent-runtime/container"

echo ""
echo "=== Building protocol-to-tfl agent image ==="
docker build \
  -f "$REPO_ROOT/apps/protocol-to-tfl/container/Dockerfile" \
  -t mediforce-agent:protocol-to-tfl \
  "$REPO_ROOT/apps/protocol-to-tfl/container"

echo ""
echo "=== Done ==="
docker images --format 'table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedSince}}' | grep mediforce
