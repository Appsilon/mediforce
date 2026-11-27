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

# docker-compose.prod.yml keeps Postgres in a bind mount, which used to be the
# named volume postgres-data. Starting on an empty bind dir while the data still
# sits in that volume would init a blank database and serve it with no error.
# The deploy user can't read the 0700 data dir, so the check runs in a container.
if [ -n "$(docker volume ls -q --filter label=com.docker.compose.volume=postgres-data)" ] \
  && ! docker run --rm -v /var/lib/mediforce:/host:ro alpine:latest test -e /host/postgres-data/PG_VERSION; then
  log "ERROR: Postgres data is still in the named volume postgres-data and /var/lib/mediforce/postgres-data is empty."
  log "Move it first: docs/guides/postgres-bind-mount-migration.md"
  exit 1
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

# Each release pulls ~5 GB and `docker image prune` never removes tagged
# images. Keep the two newest X.Y.Z versions of each platform image plus the
# running one; GHCR keeps every version for a deeper rollback. `latest` and
# other tags are never touched. The background prune below frees the layers.
remove_old_release_images() {
  local image tag
  for image in ghcr.io/appsilon/mediforce-{platform-ui,migrate,container-worker}; do
    docker image ls "$image" --format '{{.Tag}}' \
      | { grep -E '^[0-9]+\.[0-9]+\.[0-9]+$' || true; } \
      | sort -rV | tail -n +3 \
      | while read -r tag; do
          if [ "$tag" = "$VERSION" ]; then continue; fi
          log "Removing old release image $image:$tag"
          docker image rm "$image:$tag" 2>&1 | tee -a "$LOG_FILE" \
            || log "WARNING: could not remove $image:$tag"
        done
  done
}
if [ "$VERSION" != "latest" ]; then
  remove_old_release_images
fi

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

# Host cron jobs (heartbeat, backup) come from this checkout on every
# deploy, so no server depends on a manual install step.
log "Installing host cron jobs"
python3 -u "$DEPLOY_DIR/scripts/cron-jobs.py" install 2>&1 | tee -a "$LOG_FILE"

log "Deployment complete — agent images still building in background"
