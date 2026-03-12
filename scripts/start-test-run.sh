#!/bin/bash
# Start a protocol-to-tfl process and resolve the upload-documents step
# with CDISC Pilot 01 test documents (protocol + SAP from GitHub).
#
# Usage: ./scripts/start-test-run.sh [base_url]
#
# Requires the dev server running (pnpm dev).

set -euo pipefail

BASE_URL="${1:-http://localhost:9003}"
API_KEY="${PLATFORM_API_KEY:-aad7fee7cb4c68d2966079ab514d6164120c0b258d74fae8749aae94117ce748}"

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEF_FILE="$SCRIPT_DIR/apps/protocol-to-tfl/src/process-definition.yaml"
DEF_VERSION=$(python3 -c "
import yaml, sys
with open('$DEF_FILE') as f:
    print(yaml.safe_load(f)['version'])
")

GITHUB_RAW="https://raw.githubusercontent.com/Appsilon/mediforce/protocol-to-tlf/apps/protocol-to-tfl/data/test-docs/cdiscpilot01"
PROTOCOL_URL="$GITHUB_RAW/cdiscpilot01-protocol.pdf"
SAP_URL="$GITHUB_RAW/cdiscpilot01-sap.pdf"

# ── Helpers ──────────────────────────────────────────────────────────────────

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -w "\n%{http_code}" -X "$method" -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json")
  if [ -n "$body" ]; then
    args+=(-d "$body")
  fi
  curl "${args[@]}" "$BASE_URL$path"
}

parse_response() {
  local response="$1"
  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')
}

die() { echo "ERROR: $1" >&2; exit 1; }

# ── 1. Discover latest config ─────────────────────────────────────────────────

echo "Querying available configs..."

RESPONSE=$(api GET "/api/configs?processName=protocol-to-tfl")
parse_response "$RESPONSE"

[ "$HTTP_CODE" = "200" ] || die "Failed to query configs (HTTP $HTTP_CODE): $BODY"

# Pick latest agent-extract config (highest version number)
CONFIG=$(echo "$BODY" | python3 -c "
import sys, json
configs = json.load(sys.stdin).get('configs', [])
agent_configs = [c for c in configs if c['configName'] == 'agent-extract']
if not agent_configs:
    print('ERROR: no agent-extract config found', file=sys.stderr)
    sys.exit(1)
latest = max(agent_configs, key=lambda c: int(c['configVersion']))
print(f\"{latest['configName']}:{latest['configVersion']}\")
")

CONFIG_NAME=$(echo "$CONFIG" | cut -d: -f1)
CONFIG_VERSION=$(echo "$CONFIG" | cut -d: -f2)

echo "Using config: $CONFIG_NAME v$CONFIG_VERSION"

# ── 2. Start process ─────────────────────────────────────────────────────────

echo "Starting protocol-to-tfl process..."

RESPONSE=$(api POST /api/processes "{
  \"definitionName\": \"protocol-to-tfl\",
  \"version\": \"$DEF_VERSION\",
  \"configName\": \"$CONFIG_NAME\",
  \"configVersion\": \"$CONFIG_VERSION\",
  \"triggeredBy\": \"test-script\",
  \"triggerName\": \"manual\",
  \"payload\": {}
}")
parse_response "$RESPONSE"

[ "$HTTP_CODE" = "201" ] || die "Failed to start process (HTTP $HTTP_CODE): $BODY"

INSTANCE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['instanceId'])")
echo "Process started: $INSTANCE_ID"

# ── 3. Wait for upload-documents task ─────────────────────────────────────────

echo "Waiting for upload-documents task..."

TASK_ID=""
for i in $(seq 1 15); do
  RESPONSE=$(api GET "/api/tasks?instanceId=$INSTANCE_ID")
  parse_response "$RESPONSE"

  if [ "$HTTP_CODE" = "200" ]; then
    TASK_ID=$(echo "$BODY" | python3 -c "
import sys, json
tasks = json.load(sys.stdin).get('tasks', [])
for t in tasks:
    if t['stepId'] == 'upload-documents' and t['status'] in ('pending', 'claimed'):
        print(t['id'])
        break
" 2>/dev/null || true)
  fi

  if [ -n "$TASK_ID" ]; then
    break
  fi

  sleep 1
done

[ -n "$TASK_ID" ] || die "upload-documents task not found after 15s"
echo "Found task: $TASK_ID"

# ── 4. Resolve upload-documents with test files ──────────────────────────────

echo "Resolving upload-documents with cdiscpilot01 protocol + SAP..."

RESPONSE=$(api POST "/api/tasks/$TASK_ID/resolve" "{
  \"attachments\": [
    {
      \"name\": \"cdiscpilot01-protocol.pdf\",
      \"size\": 1048576,
      \"type\": \"application/pdf\",
      \"downloadUrl\": \"$PROTOCOL_URL\"
    },
    {
      \"name\": \"cdiscpilot01-sap.pdf\",
      \"size\": 524288,
      \"type\": \"application/pdf\",
      \"downloadUrl\": \"$SAP_URL\"
    }
  ]
}")
parse_response "$RESPONSE"

[ "$HTTP_CODE" = "200" ] || die "Failed to resolve task (HTTP $HTTP_CODE): $BODY"

echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""
echo "Test run started. Process: $INSTANCE_ID"
echo "The auto-runner will now execute extract-metadata (agent step)."
echo "Monitor at: $BASE_URL"
