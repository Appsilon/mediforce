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

# Pull latest code
log "Pulling latest changes from main"
git fetch origin main
git reset --hard origin/main

# Build and restart only changed services
log "Building images"
docker compose -f "$COMPOSE_FILE" build

log "Starting services"
docker compose -f "$COMPOSE_FILE" up -d

# Clean up old images
docker image prune -f >> "$LOG_FILE" 2>&1

log "Deployment complete"
docker compose -f "$COMPOSE_FILE" ps
