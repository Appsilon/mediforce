#!/bin/bash
set -euo pipefail

cd /opt/mediforce
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"

echo "==> Pulling latest code"
git fetch origin
git reset --hard origin/$(git rev-parse --abbrev-ref HEAD)

echo "==> Pruning Docker build cache"
docker builder prune -af --filter "until=72h" 2>/dev/null || true
docker image prune -af --filter "until=72h" 2>/dev/null || true

export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)
echo "==> Building (SHA: $NEXT_PUBLIC_GIT_SHA)"

if [ "${1:-}" = "--no-cache" ]; then
  $COMPOSE build --no-cache platform-ui
else
  $COMPOSE build
fi

echo "==> Restarting services"
$COMPOSE up -d --force-recreate

echo "==> Done"
$COMPOSE ps
