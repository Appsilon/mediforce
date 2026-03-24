#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/opt/mediforce"
COMPOSE_FILE="docker-compose.prod.yml"
LOG_FILE="/var/log/mediforce-deploy.log"

log() {
  echo "[$(date -Iseconds)] $*" | tee -a "$LOG_FILE"
}

cd "$DEPLOY_DIR"

log "Starting deployment"

# Ensure deploy user owns .git (root operations can steal ownership)
if [ -w "$DEPLOY_DIR/.git/HEAD" ]; then
  log "Git directory permissions OK"
else
  log "ERROR: Cannot write to .git/HEAD — fix with: sudo chown -R $(whoami) $DEPLOY_DIR/.git"
  exit 1
fi

# Pull latest code (checkout -f handles stale local changes)
BRANCH=$(git rev-parse --abbrev-ref HEAD)
log "Pulling latest changes from $BRANCH"
git fetch origin "$BRANCH"
git checkout -f "$BRANCH"
git reset --hard "origin/$BRANCH"

# Export git SHA for build-time inlining
export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)
log "Git SHA: $NEXT_PUBLIC_GIT_SHA"

# Build agent images
log "Building agent images"
bash "$DEPLOY_DIR/scripts/rebuild-docker-images.sh"

# Build and restart services
log "Building images"
docker compose -f "$COMPOSE_FILE" build

log "Starting services"
docker compose -f "$COMPOSE_FILE" up -d

# Clean up old images and build cache
docker image prune -f >> "$LOG_FILE" 2>&1
docker builder prune -f --keep-storage=5GB >> "$LOG_FILE" 2>&1

log "Deployment complete"
docker compose -f "$COMPOSE_FILE" ps
