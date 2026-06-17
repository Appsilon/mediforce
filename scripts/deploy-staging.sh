#!/bin/bash
set -euo pipefail

DEPLOY_SHA="${1:?Usage: deploy-staging.sh <commit-sha>}"

cd /opt/mediforce
COMPOSE="docker compose -f docker-compose.prod.yml -f docker-compose.staging.yml"

echo "==> Pulling latest code"
git fetch origin
git checkout "$DEPLOY_SHA"

echo "==> Ensuring /var/lib/mediforce exists on host"
# Persistent path for the Mediforce data dir (worktrees + bare repos).
# Bind-mounted into platform-ui at the same path so step containers
# spawned via docker.sock from container-worker can find what the
# orchestrator writes. Idempotent (mkdir -p). The deploy user lacks
# sudo, so we use a rootful alpine container as a permission-elevation
# trick — the docker daemon the deploy already has access to (deploy
# is in the docker group) lets us write outside the user's home tree.
docker run --rm -v /var/lib:/host/var/lib alpine:latest \
  sh -c "mkdir -p /host/var/lib/mediforce && chmod 755 /host/var/lib/mediforce"

# Only prune when the Docker data volume is actually filling up — unconditional
# `builder prune -af` evicts the layer cache and forces every agent image to rebuild
# from scratch on each deploy, which is the main cause of staging deploy timeouts.
DOCKER_ROOT=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
USE_PCT=$(df --output=pcent "$DOCKER_ROOT" | tail -1 | tr -dc '0-9')
if [ -n "$USE_PCT" ] && [ "$USE_PCT" -gt 80 ]; then
  echo "==> Docker volume at ${USE_PCT}% (${DOCKER_ROOT}) — pruning build cache"
  docker builder prune -af 2>/dev/null || true
  docker image prune -f 2>/dev/null || true
else
  echo "==> Docker volume at ${USE_PCT:-?}% — skipping prune to keep layer cache"
fi

export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)

echo "==> Pulling pre-built platform images from registry"
$COMPOSE pull --ignore-pull-failures 2>/dev/null || true

if [ "${2:-}" = "--no-cache" ]; then
  echo "==> Rebuilding platform-ui (no-cache, SHA: $NEXT_PUBLIC_GIT_SHA)"
  $COMPOSE build --no-cache platform-ui
else
  echo "==> Starting services (builds locally if pull missed any image, SHA: $NEXT_PUBLIC_GIT_SHA)"
fi

# --remove-orphans kills containers left over from services that no longer
# exist in the compose files — an orphaned worker once kept consuming the
# BullMQ queue with weeks-old code.
$COMPOSE up -d --force-recreate --remove-orphans

echo "==> Platform running"
$COMPOSE ps

echo "==> Building agent runtime images in background"
nohup bash -c "
  bash scripts/rebuild-docker-images.sh >> /var/log/mediforce-deploy.log 2>&1
  docker image prune -f >> /var/log/mediforce-deploy.log 2>&1
  echo \"[\$(date -Iseconds)] Agent images ready\" >> /var/log/mediforce-deploy.log
" >> /var/log/mediforce-deploy.log 2>&1 &

echo "==> Done — agent images building in background"
