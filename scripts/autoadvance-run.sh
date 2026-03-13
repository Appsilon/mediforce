#!/bin/bash
# Auto-advance a running process by polling for human tasks and resolving them.
# Resolves upload-sdtm with CDISC Pilot 01 SDTM .xpt files from GitHub.
# Also auto-approves any L3 agent review tasks.
#
# Usage: ./scripts/autoadvance-run.sh <instanceId> [base_url]

set -euo pipefail

INSTANCE_ID="${1:-}"
BASE_URL="${2:-http://localhost:9003}"
API_KEY="${PLATFORM_API_KEY:-aad7fee7cb4c68d2966079ab514d6164120c0b258d74fae8749aae94117ce748}"

if [ -z "$INSTANCE_ID" ]; then
  echo "Usage: $0 <instanceId> [base_url]" >&2
  exit 1
fi

GITHUB_RAW="https://raw.githubusercontent.com/Appsilon/mediforce/protocol-to-tlf/apps/protocol-to-tfl/data/test-docs/cdiscpilot01"

SDTM_FILES=(ae cm dm ds ex lb mh qs relrec sc se suppae suppdm suppds supplb sv ta te ti ts tv vs)

PROTOCOL_DOCS=(cdiscpilot01-protocol.pdf cdiscpilot01-sap.pdf)

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

# ── Poll loop ────────────────────────────────────────────────────────────────

echo "Auto-advancing process: $INSTANCE_ID"
echo "Polling for human tasks..."

MAX_POLLS=30  # 30 minutes max (30 * 60s)
POLL_COUNT=0

while [ "$POLL_COUNT" -lt "$MAX_POLLS" ]; do
  POLL_COUNT=$((POLL_COUNT + 1))

  # Check instance status
  RESPONSE=$(api GET "/api/processes/$INSTANCE_ID")
  parse_response "$RESPONSE"

  if [ "$HTTP_CODE" != "200" ]; then
    echo "  Failed to get instance (HTTP $HTTP_CODE)"
    sleep 60
    continue
  fi

  STATUS=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status','unknown'))")
  STEP=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('currentStepId','none'))")

  if [ "$STATUS" = "completed" ]; then
    echo ""
    echo "Process completed!"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 0
  fi

  if [ "$STATUS" = "failed" ]; then
    echo ""
    echo "Process failed!"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 1
  fi

  if [ "$STATUS" != "paused" ]; then
    echo "  [$POLL_COUNT] Status: $STATUS, step: $STEP — waiting..."
    sleep 60
    continue
  fi

  # Status is paused — look for a pending task
  RESPONSE=$(api GET "/api/tasks?instanceId=$INSTANCE_ID")
  parse_response "$RESPONSE"

  if [ "$HTTP_CODE" != "200" ]; then
    sleep 60
    continue
  fi

  TASK_INFO=$(echo "$BODY" | python3 -c "
import sys, json
tasks = json.load(sys.stdin).get('tasks', [])
for t in tasks:
    if t['status'] in ('pending', 'claimed'):
        print(f\"{t['id']}:{t['stepId']}\")
        break
" 2>/dev/null || true)

  if [ -z "$TASK_INFO" ]; then
    echo "  [$POLL_COUNT] Paused but no pending task — waiting..."
    sleep 60
    continue
  fi

  TASK_ID=$(echo "$TASK_INFO" | cut -d: -f1)
  TASK_STEP=$(echo "$TASK_INFO" | cut -d: -f2-)

  echo "  Found task: $TASK_ID (step: $TASK_STEP)"

  # ── Resolve based on step type ──────────────────────────────────────────

  case "$TASK_STEP" in
    upload-documents)
      echo "  Resolving upload-documents with ${#PROTOCOL_DOCS[@]} protocol/SAP PDFs..."

      ATTACHMENTS="["
      FIRST=true
      for FILE in "${PROTOCOL_DOCS[@]}"; do
        if [ "$FIRST" = true ]; then
          FIRST=false
        else
          ATTACHMENTS+=","
        fi
        ATTACHMENTS+="{\"name\":\"${FILE}\",\"size\":131072,\"type\":\"application/pdf\",\"downloadUrl\":\"${GITHUB_RAW}/${FILE}\"}"
      done
      ATTACHMENTS+="]"

      RESPONSE=$(api POST "/api/tasks/$TASK_ID/resolve" "{\"attachments\":$ATTACHMENTS}")
      parse_response "$RESPONSE"

      if [ "$HTTP_CODE" = "200" ]; then
        echo "  upload-documents resolved. Auto-runner will continue..."
      else
        die "Failed to resolve upload-documents (HTTP $HTTP_CODE): $BODY"
      fi
      ;;

    upload-sdtm)
      echo "  Resolving upload-sdtm with ${#SDTM_FILES[@]} SDTM .xpt files..."

      ATTACHMENTS="["
      FIRST=true
      for FILE in "${SDTM_FILES[@]}"; do
        if [ "$FIRST" = true ]; then
          FIRST=false
        else
          ATTACHMENTS+=","
        fi
        ATTACHMENTS+="{\"name\":\"${FILE}.xpt\",\"size\":65536,\"type\":\"application/octet-stream\",\"downloadUrl\":\"${GITHUB_RAW}/sdtm/${FILE}.xpt\"}"
      done
      ATTACHMENTS+="]"

      RESPONSE=$(api POST "/api/tasks/$TASK_ID/resolve" "{\"attachments\":$ATTACHMENTS}")
      parse_response "$RESPONSE"

      if [ "$HTTP_CODE" = "200" ]; then
        echo "  upload-sdtm resolved. Auto-runner will continue..."
      else
        die "Failed to resolve upload-sdtm (HTTP $HTTP_CODE): $BODY"
      fi
      ;;

    *)
      # Default: approve (works for L3 agent review tasks and other verdict steps)
      echo "  Auto-approving task for step '$TASK_STEP'..."

      RESPONSE=$(api POST "/api/tasks/$TASK_ID/resolve" '{"verdict":"approve","comment":"auto-approved by autoadvance script"}')
      parse_response "$RESPONSE"

      if [ "$HTTP_CODE" = "200" ]; then
        echo "  Task approved. Auto-runner will continue..."
      elif [ "$HTTP_CODE" = "422" ]; then
        echo "  WARNING: Server rejected approval (HTTP 422) — agent likely produced no output."
        echo "  Error: $(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('error','unknown'))" 2>/dev/null || echo "$BODY")"
        echo "  Step '$TASK_STEP' needs manual review. Stopping autoadvance."
        exit 1
      else
        die "Failed to approve task (HTTP $HTTP_CODE): $BODY"
      fi
      ;;
  esac

  sleep 3
done

echo "Timed out after $MAX_POLLS polls"
exit 1
