#!/bin/bash
# Quick test: start a workflow-designer run, resolve describe-idea,
# then wait for generate-steps agent to finish.
#
# Usage: ./scripts/test-workflow-designer.sh [base_url]

set -euo pipefail

BASE_URL="${1:-http://localhost:9003}"
API_KEY="${MEDIFORCE_API_KEY:-${PLATFORM_API_KEY:-}}"

if [ -z "$API_KEY" ]; then
  echo "ERROR: Set MEDIFORCE_API_KEY or PLATFORM_API_KEY env var" >&2
  exit 1
fi

api() {
  local method="$1" path="$2" body="${3:-}"
  local args=(-s -w "\n%{http_code}" -X "$method" -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json")
  if [ -n "$body" ]; then
    args+=(-d "@-")
    echo "$body" | curl "${args[@]}" "$BASE_URL$path"
  else
    curl "${args[@]}" "$BASE_URL$path"
  fi
}

parse() {
  HTTP_CODE=$(echo "$1" | tail -1)
  BODY=$(echo "$1" | sed '$d')
}

die() { echo "ERROR: $1" >&2; exit 1; }

# ── 1. Start run ────────────────────────────────────────────────────────────

echo "Starting workflow-designer run..."
RESP=$(api POST /api/processes '{"definitionName":"workflow-designer","triggeredBy":"test-script"}')
parse "$RESP"
[ "$HTTP_CODE" = "201" ] || die "Failed to start (HTTP $HTTP_CODE): $BODY"

INSTANCE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['instanceId'])")
echo "Instance: $INSTANCE_ID"
echo "UI: $BASE_URL/workflows/workflow-designer/runs/$INSTANCE_ID"

# ── 2. Wait for describe-idea task ──────────────────────────────────────────

echo "Waiting for describe-idea task..."
TASK_ID=""
for i in $(seq 1 20); do
  RESP=$(api GET "/api/tasks?instanceId=$INSTANCE_ID")
  parse "$RESP"
  if [ "$HTTP_CODE" = "200" ]; then
    TASK_ID=$(echo "$BODY" | python3 -c "
import sys, json
tasks = json.load(sys.stdin).get('tasks', [])
for t in tasks:
    if t['stepId'] == 'describe-idea' and t['status'] in ('pending', 'claimed'):
        print(t['id'])
        break
" 2>/dev/null || true)
  fi
  [ -n "$TASK_ID" ] && break
  sleep 1
done
[ -n "$TASK_ID" ] || die "describe-idea task not found after 20s"
echo "Task: $TASK_ID"

# ── 3. Resolve with idea-to-blogpost ────────────────────────────────────────

echo "Resolving describe-idea..."
RESOLVE_BODY=$(python3 << 'PYEOF'
import json
idea = """We want to create a workflow for writing company blog posts.

Step 1: Author describes the idea and pastes supporting material (Slack thread, docs, bullet points).

Step 2: Clarification — AI identifies strengths and weaknesses, proposes several angles for the post (1 out of N selection). A reviewer picks the best angle or rejects.

Step 3: Draft outline — AI creates a high-level plan. Goes through review, feedback incorporated.

Step 4: Ghostwriting — full blog post is written. Deployed to preview server for inline comments.

Step 5: Final approval — designated reviewer approves or sends back for revision.

Target audience: developer/tech audience interested in AI-powered workflow automation.
Company: Mediforce — platform for orchestrating human-AI workflows in regulated industries."""

print(json.dumps({"paramValues": {"idea": idea, "workflowName": "idea-to-blogpost"}}))
PYEOF
)

RESP=$(api POST "/api/tasks/$TASK_ID/resolve" "$RESOLVE_BODY")
parse "$RESP"
[ "$HTTP_CODE" = "200" ] || die "Failed to resolve (HTTP $HTTP_CODE): $BODY"

NEXT=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin).get('nextStepId','?'))")
echo "Resolved. Next step: $NEXT"
echo ""
echo "Instance: $INSTANCE_ID"
echo "UI: $BASE_URL/workflows/workflow-designer/runs/$INSTANCE_ID"
echo ""
echo "Agent is now generating steps. Watch the server logs."
