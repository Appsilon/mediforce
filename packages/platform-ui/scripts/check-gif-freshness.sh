#!/bin/bash
# Check that journey test changes have matching GIF updates.
# Usage:
#   ./scripts/check-gif-freshness.sh              # compares against origin/main
#   ./scripts/check-gif-freshness.sh <base-sha>   # compares against specific commit

set -euo pipefail

BASE="${1:-origin/main}"
CHANGED=$(git diff --name-only "$BASE"...HEAD 2>/dev/null || git diff --name-only "$BASE" HEAD)

JOURNEYS_CHANGED=$(echo "$CHANGED" | grep -c 'e2e/journeys/' || true)
GIFS_CHANGED=$(echo "$CHANGED" | grep -c 'docs/features/.*\.gif' || true)

if [ "$JOURNEYS_CHANGED" -gt 0 ] && [ "$GIFS_CHANGED" -eq 0 ]; then
  echo "❌ Journey tests changed ($JOURNEYS_CHANGED files) but no GIFs updated in docs/features/."
  echo ""
  echo "Run: cd packages/platform-ui && pnpm test:e2e:gif"
  exit 1
fi

echo "✓ Journey tests changed: $JOURNEYS_CHANGED, GIFs updated: $GIFS_CHANGED — OK"
