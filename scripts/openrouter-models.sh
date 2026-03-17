#!/usr/bin/env bash
# Query OpenRouter models and their prices, with optional name filtering.
# Usage:
#   ./scripts/openrouter-models.sh                  # all models
#   ./scripts/openrouter-models.sh claude            # filter by "claude"
#   ./scripts/openrouter-models.sh "gpt-4"           # filter by "gpt-4"
#   ./scripts/openrouter-models.sh claude --json     # raw JSON output

set -euo pipefail

FILTER="${1:-}"
RAW_JSON=false
[[ "${2:-}" == "--json" ]] && RAW_JSON=true

API_URL="https://openrouter.ai/api/v1/models"

response=$(curl -s "$API_URL")

if $RAW_JSON; then
  if [[ -n "$FILTER" ]]; then
    echo "$response" | jq --arg f "$FILTER" '[.data[] | select(.id | ascii_downcase | contains($f | ascii_downcase))]'
  else
    echo "$response" | jq '.data'
  fi
  exit 0
fi

echo "$response" | jq -r --arg f "$FILTER" '
  .data
  | map(select(
      ($f == "") or
      (.id | ascii_downcase | contains($f | ascii_downcase)) or
      (.name | ascii_downcase | contains($f | ascii_downcase))
    ))
  | sort_by(.pricing.prompt | tonumber)
  | .[]
  | [
      .id,
      (if .pricing.prompt == "0" then "free" else ((.pricing.prompt | tonumber) * 1000000 | . * 100 | round / 100 | tostring) + "$/M" end),
      (if .pricing.completion == "0" then "free" else ((.pricing.completion | tonumber) * 1000000 | . * 100 | round / 100 | tostring) + "$/M" end),
      ((.context_length // 0) | tostring)
    ]
  | @tsv
' | column -t -s $'\t' | (
  printf "%-50s %-15s %-15s %s\n" "MODEL" "INPUT $/M tok" "OUTPUT $/M tok" "CONTEXT"
  printf "%-50s %-15s %-15s %s\n" "-----" "-----------" "------------" "-------"
  cat
)
