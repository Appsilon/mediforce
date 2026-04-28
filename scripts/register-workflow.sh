#!/bin/bash
# Register a WorkflowDefinition from a JSON file via the API.
#
# Usage: ./scripts/register-workflow.sh <namespace> <json-file> [base_url]
#
# The JSON file should contain a WorkflowDefinition WITHOUT version/createdAt
# (auto-assigned by the server).
#
# Examples:
#   ./scripts/register-workflow.sh Appsilon apps/workflow-designer/src/workflow-designer.wd.json
#   ./scripts/register-workflow.sh Appsilon apps/workflow-designer/src/workflow-designer.wd.json https://staging.mediforce.ai

set -euo pipefail

if [ -z "${2:-}" ]; then
  echo "Usage: $0 <namespace> <json-file> [base_url]" >&2
  echo "Example: $0 Appsilon apps/workflow-designer/src/workflow-designer.wd.json" >&2
  exit 1
fi

NAMESPACE="$1"
JSON_FILE="$2"
BASE_URL="${3:-http://localhost:9003}"
API_KEY="${MEDIFORCE_API_KEY:-${PLATFORM_API_KEY:-}}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: Set MEDIFORCE_API_KEY or PLATFORM_API_KEY env var" >&2
  exit 1
fi

if [ ! -f "$JSON_FILE" ]; then
  echo "ERROR: File not found: $JSON_FILE" >&2
  exit 1
fi

echo "Registering workflow from: $JSON_FILE (namespace: $NAMESPACE)"
echo "Target: $BASE_URL/api/workflow-definitions?namespace=$NAMESPACE"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "X-Api-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d @"$JSON_FILE" \
  "$BASE_URL/api/workflow-definitions?namespace=$NAMESPACE")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "201" ]; then
  echo "SUCCESS: $(echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY")"
else
  echo "FAILED (HTTP $HTTP_CODE):"
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  exit 1
fi
