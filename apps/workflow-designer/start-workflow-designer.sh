#!/bin/bash
# Start a workflow-designer instance and resolve the describe-idea step
# with the idea2blogpost workflow idea.
#
# Usage: ./start-workflow-designer.sh [base_url]
#
# Requires the dev server running (pnpm dev).

set -euo pipefail

BASE_URL="${1:-http://localhost:9003}"
API_KEY="${PLATFORM_API_KEY:-aad7fee7cb4c68d2966079ab514d6164120c0b258d74fae8749aae94117ce748}"

# ── Helpers ──────────────────────────────────────────────────────────────────

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

parse_response() {
  local response="$1"
  HTTP_CODE=$(echo "$response" | tail -1)
  BODY=$(echo "$response" | sed '$d')
}

die() { echo "ERROR: $1" >&2; exit 1; }

# ── 1. Find config ──────────────────────────────────────────────────────────

echo "Querying workflow-designer configs..."

for attempt in 1 2 3; do
  RESPONSE=$(api GET "/api/configs?processName=workflow-designer")
  parse_response "$RESPONSE"
  [ "$HTTP_CODE" = "200" ] && break
  echo "  Attempt $attempt: HTTP $HTTP_CODE (retrying in 3s...)"
  sleep 3
done

[ "$HTTP_CODE" = "200" ] || die "Failed to query configs (HTTP $HTTP_CODE)"

CONFIG=$(echo "$BODY" | python3 -c "
import sys, json
configs = json.load(sys.stdin).get('configs', [])
if not configs:
    print('ERROR: no configs found for workflow-designer', file=sys.stderr)
    sys.exit(1)
latest = max(configs, key=lambda c: int(c['configVersion']))
print(latest['configName'] + ':' + latest['configVersion'])
")

CONFIG_NAME=$(echo "$CONFIG" | cut -d: -f1)
CONFIG_VERSION=$(echo "$CONFIG" | cut -d: -f2)
echo "Using config: $CONFIG_NAME v$CONFIG_VERSION"

# ── 2. Start workflow ──────────────────────────────────────────────────────

echo "Starting workflow-designer instance..."

RESPONSE=$(api POST /api/processes "{
  \"definitionName\": \"workflow-designer\",
  \"version\": \"4\",
  \"configName\": \"$CONFIG_NAME\",
  \"configVersion\": \"$CONFIG_VERSION\",
  \"triggeredBy\": \"cli-script\",
  \"triggerName\": \"manual\",
  \"payload\": {}
}")
parse_response "$RESPONSE"

[ "$HTTP_CODE" = "201" ] || die "Failed to start workflow (HTTP $HTTP_CODE): $BODY"

INSTANCE_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['instanceId'])")
echo "Workflow started: $INSTANCE_ID"

# ── 3. Wait for describe-idea task ──────────────────────────────────────────

echo "Waiting for describe-idea task..."

TASK_ID=""
for i in $(seq 1 15); do
  RESPONSE=$(api GET "/api/tasks?instanceId=$INSTANCE_ID")
  parse_response "$RESPONSE"

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

  if [ -n "$TASK_ID" ]; then
    break
  fi

  sleep 1
done

[ -n "$TASK_ID" ] || die "describe-idea task not found after 15s"
echo "Found task: $TASK_ID"

# ── 4. Build resolve body with blog post workflow idea ───────────────────────

echo "Resolving describe-idea with idea2blogpost workflow idea..."

RESOLVE_BODY=$(python3 << 'PYEOF'
import json

idea = """We want to recreate in Mediforce the blog post creation workflow we currently use in our company.

The workflow starts when someone has an idea for a blog post. In the first step, the author describes the idea and pastes all relevant supporting material — this could be a Slack thread, internal documentation, a draft with bullet points, or anything that explains what the idea is about, why it is attractive, and what angle makes it compelling.

The second step is a clarification phase where we identify the strengths and weaknesses of this blog post idea. This acts as a quality gate — someone reviews whether this topic is strong enough to actually make it onto the company blog. If the idea is rejected at this stage, we loop back for the author to refine or abandon it.

If the idea passes the gate, the next step is drafting a high-level plan/outline for the blog post. This plan goes through a review cycle where feedback is collected and incorporated to strengthen the outline. The reviewer can approve or send it back for revision.

Once the outline is approved, the actual ghostwriting happens — the full blog post is written. Ideally the draft is deployed to a temporary preview server so stakeholders can read it online and leave comments inline. Those comments are incorporated iteratively.

The final step is a formal approval by a designated final reviewer. Until the final reviewer explicitly approves, the post stays in revision. Once approved, the workflow completes successfully and the blog post is ready for publication.

---

Supporting context:

Target audience: developer/tech audience interested in AI-powered workflow automation.
Company context: Mediforce is building a platform for orchestrating human-AI workflows in regulated industries.
Blog serves as thought leadership + community building + hiring signal.
Current pain points with ad-hoc workflow: ideas get lost in Slack, no structured review, inconsistent quality bar, no clear approval chain.
Examples of past blog topics: "How we use Claude to automate clinical trial workflows", "Building a workflow engine with verdict-based routing", "Why we chose Firebase for our SaaS MVP"."""

print(json.dumps({
    "paramValues": {
        "idea": idea,
        "workflowName": "idea2blogpost",
        "version": "0.1"
    }
}))
PYEOF
)

RESPONSE=$(api POST "/api/tasks/$TASK_ID/resolve" "$RESOLVE_BODY")
parse_response "$RESPONSE"

[ "$HTTP_CODE" = "200" ] || die "Failed to resolve task (HTTP $HTTP_CODE): $BODY"

echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""
echo "describe-idea resolved. Workflow: $INSTANCE_ID"
echo "The auto-runner will now execute generate-definition (agent step)."
echo "Monitor at: $BASE_URL"
