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
# Never fails the step: if Rscript errors out, we still write a structured
# fallback envelope to /output/result.json and exit 0. Mirrors validate.py's
# behavior so the downstream interpret-validation agent step always gets a
# parseable envelope (chaos classification when scriptStatus is "failed").
#
# Args (positional, forwarded to R):
#   1: rules YAML   (default: /workspace/validation-rules.yaml)
#   2: output JSON  (default: /output/result.json)

set -u  # NOTE: no `set -e` — we want to control exit explicitly.

RULES="${1:-/workspace/validation-rules.yaml}"
OUTPUT="${2:-/output/result.json}"

emit_fallback() {
  status="$1"
  classification="$2"
  reason="$3"
  cat > "$OUTPUT" <<JSON
{
  "scriptStatus": "$status",
  "classification": "$classification",
  "classificationReason": "$reason",
  "summary": "$reason",
  "rulesPassed": 0,
  "rulesFailed": 0,
  "rulesError": 0,
  "results": [],
  "source": "validate_custom.sh fallback"
}
JSON
}

DELIVERY=$(ls -d /workspace/incoming/d-*/ 2>/dev/null | sort | tail -1)
if [ -z "$DELIVERY" ]; then
  echo "validate_custom: no delivery directory under /workspace/incoming/" >&2
  emit_fallback "failed" "chaos" "validate-custom: no delivery directory under /workspace/incoming/"
  exit 0
fi

if [ ! -f "/workspace/validate_custom.R" ]; then
  echo "validate_custom: /workspace/validate_custom.R missing — study repo not bootstrapped?" >&2
  emit_fallback "failed" "chaos" "validate-custom: study script /workspace/validate_custom.R not found in workspace"
  exit 0
fi

if [ ! -f "$RULES" ]; then
  echo "validate_custom: rules file $RULES missing — study repo not bootstrapped?" >&2
  emit_fallback "failed" "chaos" "validate-custom: rules file $RULES not found in workspace"
  exit 0
fi

echo "validate_custom: delivery=$DELIVERY rules=$RULES output=$OUTPUT"

if Rscript /workspace/validate_custom.R "$DELIVERY" "$RULES" "$OUTPUT"; then
  rc=0
else
  rc=$?
fi

if [ "$rc" -ne 0 ]; then
  echo "validate_custom: Rscript exited with $rc — emitting failure envelope" >&2
  emit_fallback "failed" "chaos" "validate-custom: Rscript exited with $rc — see container logs for R traceback"
fi

exit 0
