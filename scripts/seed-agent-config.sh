#!/bin/bash
# Seed the "agent-extract" process config for protocol-to-tfl.
# Usage: ./scripts/seed-agent-config.sh [base_url]
#
# Requires the dev server running (pnpm dev) or specify a base URL.
# Uses POST /api/configs which validates against the process definition.

BASE_URL="${1:-http://localhost:9003}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIG_FILE="$SCRIPT_DIR/apps/protocol-to-tfl/src/process-config.json"

echo "Seeding agent-extract config from: $CONFIG_FILE"
echo "Target: $BASE_URL/api/configs"

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d @"$CONFIG_FILE" \
  "$BASE_URL/api/configs")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP $HTTP_CODE"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

if [ "$HTTP_CODE" = "201" ]; then
  echo "Config seeded successfully."
elif [ "$HTTP_CODE" = "409" ]; then
  echo "Config already exists (409 Conflict). Delete or bump configVersion."
else
  echo "Failed to seed config."
  exit 1
fi
