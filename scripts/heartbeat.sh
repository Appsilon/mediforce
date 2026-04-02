#!/bin/bash
set -euo pipefail
source /opt/mediforce/.env

URL="https://${DOMAIN}/api/cron/heartbeat"
LOG="/opt/mediforce/logs/heartbeat.log"

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$URL" \
  -H "X-Api-Key: $PLATFORM_API_KEY" \
  -H "Content-Type: application/json" 2>/dev/null) || HTTP_CODE="FAIL"

printf "[%s] %s\n" "$(date -Iseconds)" "$HTTP_CODE" >> "$LOG"
