#!/bin/bash
# Convert E2E test recordings (webm) to GIFs in docs/features/
# Usage:
#   ./scripts/e2e-to-gif.sh                    # convert all recordings
#   ./scripts/e2e-to-gif.sh task-review        # convert only matching recordings

set -euo pipefail

FEATURES_DIR="../../docs/features"
RESULTS_DIR="test-results"
FILTER="${1:-}"

if ! command -v ffmpeg &>/dev/null; then
  echo "Error: ffmpeg not found. Install with: brew install ffmpeg"
  exit 1
fi

if [ ! -d "$RESULTS_DIR" ]; then
  echo "Error: No test-results/ directory. Run pnpm test:e2e:record first."
  exit 1
fi

mkdir -p "$FEATURES_DIR"

count=0
for dir in "$RESULTS_DIR"/*/; do
  video="$dir/video.webm"
  [ -f "$video" ] || continue

  dirname=$(basename "$dir" | sed 's/-authenticated$//')

  # Skip if filter provided and doesn't match
  if [ -n "$FILTER" ] && [[ "$dirname" != *"$FILTER"* ]]; then
    continue
  fi

  # Extract clean name from directory
  # Pattern: <file>-<hash>-<description>
  # We want a human-readable name
  name=$(echo "$dirname" | sed -E 's/\.journey\.ts-[a-f0-9]+-/--/' | sed 's/--/-/g')

  ffmpeg -y -i "$video" \
    -vf "fps=10,scale=960:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=256:stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a" \
    -loop 0 "$FEATURES_DIR/${name}.gif" 2>/dev/null

  size=$(du -h "$FEATURES_DIR/${name}.gif" | cut -f1)
  echo "✓ ${name}.gif ($size)"
  count=$((count + 1))
done

echo ""
echo "Converted $count recordings to $FEATURES_DIR/"
echo "Don't forget to update $FEATURES_DIR/FEATURES.md if new features were added."
