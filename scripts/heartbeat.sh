#!/bin/bash
set -euo pipefail
source /opt/mediforce/.env

URL="https://${DOMAIN}/api/cron/heartbeat"
LOG="/opt/mediforce/logs/heartbeat.log"
LOG_PREV="/opt/mediforce/logs/heartbeat.last-week.log"

# Weekly log rotation (Monday 00:00–00:14 window, runs every 15 min)
if [[ "$(date +%u)" == "1" && "$(date +%H)" == "00" && ! -f "$LOG.rotated-this-week" ]]; then
  mv -f "$LOG_PREV" "$LOG_PREV.tmp" 2>/dev/null || true
  mv -f "$LOG" "$LOG_PREV" 2>/dev/null || true
  rm -f "$LOG_PREV.tmp"
  touch "$LOG.rotated-this-week"
fi
# Clear rotation guard after Monday
if [[ "$(date +%u)" != "1" ]]; then
  rm -f "$LOG.rotated-this-week"
fi

HTTP_CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST "$URL" \
  -H "X-Api-Key: $PLATFORM_API_KEY" \
  -H "Content-Type: application/json" 2>/dev/null) || HTTP_CODE="FAIL"

printf "[%s] %s\n" "$(date -Iseconds)" "$HTTP_CODE" >> "$LOG"
