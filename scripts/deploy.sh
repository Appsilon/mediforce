#!/usr/bin/env bash
set -euo pipefail

# ADR-0013 — dumb, pull-only deploy. Takes a ref (release tag or SHA), checks it
# out ONLY to get the matching compose file + migration SQL, then pulls the
# pinned images and brings the stack up. The running version is decided by the
# image tag (:prod-current on prod, :latest on staging via the overlay), NOT by
# this git checkout. Fail-loud: if a pinned image is missing the deploy stops
# instead of improvising an on-box build.
#
# Prod (default):
#   /opt/mediforce/scripts/deploy.sh <release-tag-or-sha>
# Staging (overlay overrides the app images back to :latest):
#   COMPOSE_FILES='docker-compose.prod.yml docker-compose.staging.yml' \
#     /opt/mediforce/scripts/deploy.sh <sha>
#
# Rollback correctness depends on the box's git clone at /opt/mediforce staying
# FULL (not shallow): `git checkout -f <old-sha>` must resolve arbitrary historic
# SHAs. A shallow re-provision would break checkout of an old ref.

REF="${1:?Usage: deploy.sh <release-tag-or-sha>}"

DEPLOY_DIR="/opt/mediforce"
LOG_FILE="/var/log/mediforce-deploy.log"
COMPOSE_FILES="${COMPOSE_FILES:-docker-compose.prod.yml}"

COMPOSE_ARGS=()
for f in $COMPOSE_FILES; do
  COMPOSE_ARGS+=(-f "$f")
done

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

cd "$DEPLOY_DIR"

log "Starting deployment of ref: $REF"

# Ensure the deploy user owns .git (root operations can steal ownership).
if [ ! -w "$DEPLOY_DIR/.git/HEAD" ]; then
  log "ERROR: Cannot write to .git/HEAD — fix with: sudo chown -R $(whoami) $DEPLOY_DIR/.git"
  exit 1
fi

# Check out the requested ref only for the compose file + migration SQL. No
# branch-follow, no `git reset --hard origin/<branch>` — the image tag, not the
# git branch, is what runs.
log "Fetching tags and checking out $REF"
git fetch --tags origin
git checkout -f "$REF"

# Persistent Mediforce data dir on the host (worktrees + bare repos), bind-mounted
# into platform-ui at the same path so docker.sock-spawned step containers resolve
# the same files the orchestrator wrote. Idempotent (mkdir -p). The deploy user
# lacks sudo, so a rootful alpine container elevates the write (deploy is in the
# docker group).
log "Ensuring /var/lib/mediforce exists on host"
docker run --rm -v /var/lib:/host/var/lib alpine:latest \
  sh -c "mkdir -p /host/var/lib/mediforce && chmod 755 /host/var/lib/mediforce"

# Only prune when the Docker data dir is actually filling up — an unconditional
# `builder prune -af` evicts the layer cache and forces every agent image to
# rebuild from scratch on each deploy, the main cause of deploy timeouts.
DOCKER_ROOT=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)
USE_PCT=$(df --output=pcent "$DOCKER_ROOT" | tail -1 | tr -dc '0-9')
if [ -n "$USE_PCT" ] && [ "$USE_PCT" -gt 80 ]; then
  log "Docker volume at ${USE_PCT}% (${DOCKER_ROOT}) — pruning build cache"
  docker builder prune -af 2>/dev/null || true
  docker image prune -f 2>/dev/null || true
else
  log "Docker volume at ${USE_PCT:-?}% — skipping prune to keep layer cache"
fi

# Pull the pinned images. FAIL-LOUD: no --ignore-pull-failures, no local-build
# fallback. If the target image is missing, the deploy stops here.
log "Pulling platform images from registry"
docker compose "${COMPOSE_ARGS[@]}" pull 2>&1 | tee -a "$LOG_FILE"

log "Starting services"
# --remove-orphans kills containers left over from services that no longer exist
# in the compose file (prevents stale workers consuming shared queues).
docker compose "${COMPOSE_ARGS[@]}" up -d --remove-orphans 2>&1 | tee -a "$LOG_FILE"

log "Platform deployed"
docker compose "${COMPOSE_ARGS[@]}" ps

# Build agent images in the background — the platform is already serving.
# Workflows that need a container fail until images are ready; that's fine
# because the user still needs to set up workflows first.
log "Building agent images in background (log: $LOG_FILE)"
nohup bash -c "
  bash '$DEPLOY_DIR/scripts/rebuild-docker-images.sh' >> '$LOG_FILE' 2>&1
  docker image prune -f >> '$LOG_FILE' 2>&1
  echo \"[\$(date -Iseconds)] Agent images ready\" >> '$LOG_FILE'
" >> "$LOG_FILE" 2>&1 &

log "Deployment complete — agent images still building in background"
