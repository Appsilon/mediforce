#!/bin/sh
# Layer-2 custom validation wrapper.
#
# Picks the most recent delivery subdir under /workspace/incoming/d-<ts>/
# (created by sftp_poll.py) and runs the study-specific R validator on it.
#
# Lives here as a shell script — not as the bare wd.json command — because
# script-container-plugin splits `command` on whitespace and execs argv
# directly (no shell), so `$(...)` substitution would never expand.
#
# Args (positional, forwarded to R):
#   1: delivery dir (auto-picked: latest /workspace/incoming/d-*/)
#   2: rules YAML   (default: /workspace/validation-rules.yaml)
#   3: output JSON  (default: /output/result.json)

set -eu

RULES="${1:-/workspace/validation-rules.yaml}"
OUTPUT="${2:-/output/result.json}"

DELIVERY=$(ls -d /workspace/incoming/d-*/ 2>/dev/null | sort | tail -1)
if [ -z "$DELIVERY" ]; then
  echo "validate_custom: no delivery directory under /workspace/incoming/" >&2
  exit 2
fi

echo "validate_custom: delivery=$DELIVERY rules=$RULES output=$OUTPUT"
exec Rscript /workspace/validate_custom.R "$DELIVERY" "$RULES" "$OUTPUT"
