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

# Pull pre-built images from registry (skips the 5-7 min local build).
# Falls back to local build if registry is unreachable or first deploy
# before CI has run.
log "Pulling platform images from registry"
docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures 2>&1 | tee -a "$LOG_FILE" || true

log "Starting services (builds locally if pull missed any image)"
# --remove-orphans kills containers left over from services that no longer
# exist in the compose file (prevents stale workers consuming shared queues).
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

log "Platform deployed"
docker compose -f "$COMPOSE_FILE" ps

# Build agent images in the background — platform is already serving.
# Workflows that need a container will fail until images are ready;
# that's fine because the user still needs to set up workflows first.
log "Building agent images in background (log: $LOG_FILE)"
nohup bash -c "
  bash '$DEPLOY_DIR/scripts/rebuild-docker-images.sh' >> '$LOG_FILE' 2>&1
  docker image prune -f >> '$LOG_FILE' 2>&1
  docker builder prune -f --keep-storage=5GB >> '$LOG_FILE' 2>&1
  echo \"[\$(date -Iseconds)] Agent images ready\" >> '$LOG_FILE'
" >> "$LOG_FILE" 2>&1 &

log "Deployment complete — agent images still building in background"
