#!/bin/bash
set -euo pipefail

DEPLOY_SHA="${1:?Usage: deploy-staging.sh <commit-sha>}"

cd /opt/mediforce
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"

echo "==> Pulling latest code"
git fetch origin
git checkout "$DEPLOY_SHA"

echo "==> Pruning Docker build cache + unused images"
# Unconditional prune — daemon-level builder GC cap (see /etc/docker/daemon.json)
# provides the steady-state guarantee; this keeps each deploy's working set lean.
docker builder prune -af 2>/dev/null || true
docker image prune -af 2>/dev/null || true

# Early warning if the Docker data volume is filling up
DOCKER_ROOT=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
USE_PCT=$(df --output=pcent "$DOCKER_ROOT" | tail -1 | tr -dc '0-9')
if [ -n "$USE_PCT" ] && [ "$USE_PCT" -gt 80 ]; then
  echo "WARN: docker volume at ${USE_PCT}% (${DOCKER_ROOT}) — GC cap may need lowering" >&2
fi

export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)
echo "==> Building (SHA: $NEXT_PUBLIC_GIT_SHA)"

if [ "${2:-}" = "--no-cache" ]; then
  $COMPOSE build --no-cache platform-ui
else
  $COMPOSE build
fi

echo "==> Restarting services"
$COMPOSE up -d --force-recreate

echo "==> Done"
$COMPOSE ps
