#!/bin/bash
# Seed all process definitions and configs into the local dev server.
# Usage: ./scripts/seed-local.sh [base_url]
#
# Prerequisites:
#   1. Emulators running:  cd packages/platform-ui && pnpm emulators
#   2. Dev server running: cd packages/platform-ui && pnpm dev
#
# Definitions are seeded first (PUT /api/definitions with YAML body),
# then configs (POST /api/configs with JSON body).

set -euo pipefail

BASE_URL="${1:-http://localhost:9003}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API_KEY="${MEDIFORCE_API_KEY:-dev-platform-key-local}"

NAMESPACE="${MEDIFORCE_NAMESPACE:-test}"

passed=0
skipped=0
failed=0

seed_workflow_definition() {
  local json_file="$1"
  local label
  label="$(basename "$(dirname "$(dirname "$json_file")")")/$(basename "$json_file")"

  printf "  %-60s " "$label"

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $API_KEY" \
    -d @"$json_file" \
    "$BASE_URL/api/workflow-definitions?namespace=$NAMESPACE")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  case "$http_code" in
    201) echo "OK"; passed=$((passed + 1)) ;;
    409) echo "SKIP (already exists)"; skipped=$((skipped + 1)) ;;
    *)   echo "FAIL (HTTP $http_code)"; echo "    $body"; failed=$((failed + 1)) ;;
  esac
}

seed_definition() {
  local yaml_file="$1"
  local label
  label="$(basename "$(dirname "$(dirname "$yaml_file")")")/$(basename "$yaml_file")"

  printf "  %-60s " "$label"

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" \
    -X PUT \
    -H "Content-Type: text/yaml" \
    -H "X-Api-Key: $API_KEY" \
    --data-binary @"$yaml_file" \
    "$BASE_URL/api/definitions")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  case "$http_code" in
    201) echo "OK"; passed=$((passed + 1)) ;;
    409) echo "SKIP (already exists)"; skipped=$((skipped + 1)) ;;
    *)   echo "FAIL (HTTP $http_code)"; echo "    $body"; failed=$((failed + 1)) ;;
  esac
}

seed_config() {
  local json_file="$1"
  local label
  label="$(basename "$(dirname "$(dirname "$json_file")")")/$(basename "$json_file")"

  printf "  %-60s " "$label"

  local response http_code body
  response=$(curl -s -w "\n%{http_code}" \
    -X POST \
    -H "Content-Type: application/json" \
    -H "X-Api-Key: $API_KEY" \
    -d @"$json_file" \
    "$BASE_URL/api/configs")

  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')

  case "$http_code" in
    201) echo "OK"; passed=$((passed + 1)) ;;
    409) echo "SKIP (already exists)"; skipped=$((skipped + 1)) ;;
    *)   echo "FAIL (HTTP $http_code)"; echo "    $body"; failed=$((failed + 1)) ;;
  esac
}

echo "Seeding local dev server at $BASE_URL (namespace: $NAMESPACE)"
echo ""

# --- Workflow Definitions (new unified schema, namespace-scoped) ---
echo "Workflow Definitions (namespace=$NAMESPACE):"
seed_workflow_definition "$REPO_ROOT/apps/workflow-designer-2/src/workflow-designer-2.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/workflow-designer/src/workflow-designer.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/workflow-designer/src/cowork-workflow-designer.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/workflow-designer/src/voice-workflow-designer.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/community-digest/src/community-digest.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/community-digest/src/community-digest-sonnet45.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/protocol-to-tfl/src/protocol-to-tfl.wd.json"
seed_workflow_definition "$REPO_ROOT/apps/estimand-extractor/src/estimand-extractor.wd.json"
echo ""

# --- Legacy Process Definitions (kept for backward compatibility) ---
echo "Legacy Process Definitions:"
seed_definition "$REPO_ROOT/apps/protocol-to-tfl/src/process-definition.yaml"
seed_definition "$REPO_ROOT/apps/supply-intelligence/src/lib/process-definitions/supply-intelligence-analysis.yaml"
echo ""

# --- Configs (definition must exist first) ---
echo "Process Configs:"
seed_config "$REPO_ROOT/apps/protocol-to-tfl/src/process-config-claude.json"
seed_config "$REPO_ROOT/apps/protocol-to-tfl/src/process-config-local.json"
seed_config "$REPO_ROOT/apps/protocol-to-tfl/src/process-config-opencode.json"
echo ""

# --- Summary ---
echo "Done: $passed seeded, $skipped skipped, $failed failed."
if [ "$failed" -gt 0 ]; then
  exit 1
fi
