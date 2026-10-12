#!/bin/bash
# deploy.sh <version>   Deploys a release. deploy-production.yml checks out its tag first:
#   git fetch --force --tags origin && git checkout -f v1.4.0 && scripts/deploy.sh 1.4.0
# deploy.sh             Deploys the checked-out branch's head with :latest images
#                       (bootstrap-server.py's first deploy of a new server).
set -euo pipefail

VERSION="${1:-}"
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

if [ -n "$VERSION" ]; then
  if [ "$(git rev-parse HEAD)" != "$(git rev-parse "v$VERSION^{commit}")" ]; then
    log "ERROR: HEAD is not tag v$VERSION — run: git fetch --force --tags origin && git checkout -f v$VERSION"
    exit 1
  fi
  log "Deploying v$VERSION"
else
  # Pull latest code (checkout -f handles stale local changes)
  BRANCH=$(git rev-parse --abbrev-ref HEAD)
  if [ "$BRANCH" = "HEAD" ]; then
    log "ERROR: HEAD is detached (a release is checked out) — pass its version: scripts/deploy.sh <version>"
    exit 1
  fi
  log "Pulling latest changes from $BRANCH"
  git fetch origin "$BRANCH"
  git checkout -f "$BRANCH"
  git reset --hard "origin/$BRANCH"
  VERSION=latest
fi

# docker-compose.prod.yml pins its images to MEDIFORCE_VERSION. Keeping it in
# .env means a later manual `docker compose up` stays on this version.
if grep -q '^MEDIFORCE_VERSION=' .env 2>/dev/null; then
  sed -i "s/^MEDIFORCE_VERSION=.*/MEDIFORCE_VERSION=$VERSION/" .env
else
  echo "MEDIFORCE_VERSION=$VERSION" >> .env
fi
export MEDIFORCE_VERSION="$VERSION"

# Export git SHA for build-time inlining
export NEXT_PUBLIC_GIT_SHA=$(git rev-parse --short HEAD)
log "Git SHA: $NEXT_PUBLIC_GIT_SHA"

# Pull this version's pre-built images (skips the 5-7 min local build). Falls
# back to building the checked-out code locally if the registry is unreachable
# or the version predates versioned images.
log "Pulling platform images from registry"
docker compose -f "$COMPOSE_FILE" pull --ignore-pull-failures 2>&1 | tee -a "$LOG_FILE" || true

# The worker goes first, on its own. A job carries bulk payloads (workspace
# files, an oversized prompt) under Redis keys the worker has to know how to
# read; a platform newer than its worker would enqueue a job the old worker
# runs with the payload missing and no error. One `up -d` recreates both at
# once with no ordering between them, so the worker leads by a separate call.
log "Starting the container worker first (it must not lag the platform)"
docker compose -f "$COMPOSE_FILE" up -d container-worker

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
