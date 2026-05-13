#!/usr/bin/env bash
# Deploy the Landing Zone demo console to the Hetzner host.
# Idempotent — safe to re-run. Will create what's missing, update what's stale,
# restart the service.
#
# Runs as a deploy user with shell access. The app itself talks SFTP back to
# localhost as the SFTP user — that way no shell write access to the SFTP
# user's chrooted upload dir is required.
#
# Required env vars:
#   LANDING_ZONE_HOST           hostname or IP of the Hetzner host
#   LANDING_ZONE_SSH_USER       login with shell access (e.g. "deploy")
#   LANDING_ZONE_SFTP_USER      SFTP user (e.g. "sftpuser") — used by the
#                               app to write into the chrooted upload dir
#   LANDING_ZONE_SFTP_PASSWORD  password for the SFTP user
#   LANDING_ZONE_API_KEY        DEMO_CONSOLE_API_KEY — the SPA + workflow use
#                               this to authenticate POST /seed. Generate:
#                                 openssl rand -hex 16
#
# Optional env (sensible defaults):
#   LANDING_ZONE_SSH_PORT       22
#   LANDING_ZONE_SFTP_PORT      22
#   LANDING_ZONE_SFTP_UPLOAD_DIR  /uploads          — remote (chrooted) path
#   LANDING_ZONE_EXAMPLES_DIR     ~deploy/lz-examples
#   LANDING_ZONE_INSTALL_DIR      ~deploy/lz-demo-console
#   LANDING_ZONE_PORT             8080

set -euo pipefail

: "${LANDING_ZONE_HOST:?LANDING_ZONE_HOST is required}"
: "${LANDING_ZONE_SSH_USER:?LANDING_ZONE_SSH_USER is required}"
: "${LANDING_ZONE_SFTP_USER:?LANDING_ZONE_SFTP_USER is required}"
: "${LANDING_ZONE_SFTP_PASSWORD:?LANDING_ZONE_SFTP_PASSWORD is required}"
: "${LANDING_ZONE_API_KEY:?LANDING_ZONE_API_KEY is required}"

LANDING_ZONE_SSH_PORT="${LANDING_ZONE_SSH_PORT:-22}"
LANDING_ZONE_SFTP_PORT="${LANDING_ZONE_SFTP_PORT:-22}"
LANDING_ZONE_SFTP_UPLOAD_DIR="${LANDING_ZONE_SFTP_UPLOAD_DIR:-/uploads}"
LANDING_ZONE_EXAMPLES_DIR="${LANDING_ZONE_EXAMPLES_DIR:-/home/${LANDING_ZONE_SSH_USER}/lz-examples}"
LANDING_ZONE_INSTALL_DIR="${LANDING_ZONE_INSTALL_DIR:-/home/${LANDING_ZONE_SSH_USER}/lz-demo-console}"
LANDING_ZONE_PORT="${LANDING_ZONE_PORT:-8080}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../.." && pwd)"
SAMPLE_DATA="${REPO_ROOT}/apps/landing-zone/sample-data"

VARIANTS=(clean injection injection-demo mess-encoding mess-inconsistent-values mess-missing-domain)

SSH="ssh -p ${LANDING_ZONE_SSH_PORT} ${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST}"
RSYNC_OPTS=(-az --delete -e "ssh -p ${LANDING_ZONE_SSH_PORT}")

log() { printf '\033[1;36m[deploy]\033[0m %s\n' "$*"; }

log "checking local files…"
for f in app.py index.html pyproject.toml README.md; do
  [[ -f "${SCRIPT_DIR}/${f}" ]] || { echo "missing: ${SCRIPT_DIR}/${f}"; exit 1; }
done
for v in "${VARIANTS[@]}"; do
  [[ -d "${SAMPLE_DATA}/${v}" ]] || { echo "missing: ${SAMPLE_DATA}/${v}"; exit 1; }
done

log "checking SSH to ${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST}:${LANDING_ZONE_SSH_PORT}…"
$SSH true

log "ensuring remote dirs exist…"
$SSH "mkdir -p '${LANDING_ZONE_EXAMPLES_DIR}' '${LANDING_ZONE_INSTALL_DIR}'"

log "rsync sample-data → ${LANDING_ZONE_EXAMPLES_DIR}/ (~60MB, only changed files)…"
for v in "${VARIANTS[@]}"; do
  rsync "${RSYNC_OPTS[@]}" "${SAMPLE_DATA}/${v}/" \
    "${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST}:${LANDING_ZONE_EXAMPLES_DIR}/${v}/"
done

log "rsync app → ${LANDING_ZONE_INSTALL_DIR}/…"
rsync "${RSYNC_OPTS[@]}" \
  --exclude '__pycache__' --exclude '.pytest_cache' --exclude '.venv' \
  --exclude 'deploy.sh' \
  "${SCRIPT_DIR}/" "${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST}:${LANDING_ZONE_INSTALL_DIR}/"

log "restarting docker container 'lz-demo'…"
# Pulls deps at startup (~5s). For a demo this beats baking an image.
$SSH "docker rm -f lz-demo 2>/dev/null || true; \
  docker run -d --name lz-demo --restart unless-stopped --network host \
    -v '${LANDING_ZONE_INSTALL_DIR}:/app:ro' \
    -v '${LANDING_ZONE_EXAMPLES_DIR}:/examples:ro' \
    -e DEMO_CONSOLE_API_KEY='${LANDING_ZONE_API_KEY}' \
    -e EXAMPLES_DIR=/examples \
    -e SFTP_HOST=127.0.0.1 \
    -e SFTP_PORT='${LANDING_ZONE_SFTP_PORT}' \
    -e SFTP_USER='${LANDING_ZONE_SFTP_USER}' \
    -e SFTP_PASSWORD='${LANDING_ZONE_SFTP_PASSWORD}' \
    -e SFTP_UPLOAD_DIR='${LANDING_ZONE_SFTP_UPLOAD_DIR}' \
    -e PORT='${LANDING_ZONE_PORT}' \
    -w /app \
    python:3.12-slim \
    sh -c 'pip install --quiet --no-cache-dir --root-user-action=ignore fastapi \"uvicorn[standard]\" pydantic \"paramiko>=3\" && python -m uvicorn app:app --host 0.0.0.0 --port ${LANDING_ZONE_PORT}'"

log "waiting for /healthz…"
healthz_ok=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  if $SSH "curl -fsS --max-time 2 http://127.0.0.1:${LANDING_ZONE_PORT}/healthz" >/dev/null 2>&1; then
    $SSH "curl -fsS http://127.0.0.1:${LANDING_ZONE_PORT}/healthz" && echo
    healthz_ok=true
    break
  fi
  sleep 2
done
if [[ "${healthz_ok}" != true ]]; then
  log "healthz never came up — last 20 lines of container log:"
  $SSH "docker logs --tail 20 lz-demo" >&2 || true
  exit 1
fi

log "done."
log "  open: http://${LANDING_ZONE_HOST}:${LANDING_ZONE_PORT}/"
log "  api key: ${LANDING_ZONE_API_KEY} (paste when the SPA prompts)"
log "  logs:  ssh ${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST} 'docker logs -f lz-demo'"
log "  stop:  ssh ${LANDING_ZONE_SSH_USER}@${LANDING_ZONE_HOST} 'docker stop lz-demo'"
