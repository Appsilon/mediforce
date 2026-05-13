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

# Soft-skip envelope used when the study has no custom validation files in
# the workspace. The CDISC CORE engine (validate-script) already ran and
# emitted a classification — propagate it forward instead of overriding to
# chaos. The note tells the interpret-validation step that layer-2 was
# absent so it can render a small annotation.
#
# Reads /output/input.json (validate-script's flattened output) to lift
# classification + classificationReason + summary unchanged. If that file
# is missing or unparseable falls back to scriptStatus="ok" with no
# classification field — the downstream agent will then read steps['validate-script']
# directly per its skill instructions.
emit_skipped() {
  reason="$1"
  classification=""
  classification_reason=""
  summary=""
  script_failed_flag=""

  if [ -f /output/input.json ] && command -v jq >/dev/null 2>&1; then
    classification=$(jq -r '.classification // empty' /output/input.json 2>/dev/null)
    classification_reason=$(jq -r '.classificationReason // empty' /output/input.json 2>/dev/null)
    summary=$(jq -r '.summary // empty' /output/input.json 2>/dev/null)
    script_failed_flag=$(jq -r '.scriptFailedFlag // empty' /output/input.json 2>/dev/null)
  fi

  # Build JSON with optional classification fields. Empty string -> omit field
  # by using printf + jq -n where available; fall back to a static structure.
  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg cls "$classification" \
      --arg clsReason "$classification_reason" \
      --arg sum "$summary" \
      --arg sff "$script_failed_flag" \
      --arg reason "$reason" \
      '{
        scriptStatus: "ok",
        customValidation: "skipped",
        customValidationReason: $reason,
        rulesPassed: 0,
        rulesFailed: 0,
        rulesError: 0,
        results: [],
        source: "validate_custom.sh skipped"
      }
      + (if $cls != "" then { classification: $cls } else {} end)
      + (if $clsReason != "" then { classificationReason: $clsReason } else {} end)
      + (if $sum != "" then { summary: $sum } else {} end)
      + (if $sff != "" then { scriptFailedFlag: ($sff == "true") } else {} end)
      ' > "$OUTPUT"
  else
    cat > "$OUTPUT" <<JSON
{
  "scriptStatus": "ok",
  "customValidation": "skipped",
  "customValidationReason": "$reason",
  "rulesPassed": 0,
  "rulesFailed": 0,
  "rulesError": 0,
  "results": [],
  "source": "validate_custom.sh skipped"
}
JSON
  fi
}

DELIVERY=$(ls -d /workspace/incoming/d-*/ 2>/dev/null | sort | tail -1)
if [ -z "$DELIVERY" ]; then
  echo "validate_custom: no delivery directory under /workspace/incoming/" >&2
  emit_fallback "failed" "chaos" "validate-custom: no delivery directory under /workspace/incoming/"
  exit 0
fi

dump_workspace_state() {
  echo "--- workspace contents ---" >&2
  ls -la /workspace/ 2>&1 | head -40 >&2 || true
  echo "--- git HEAD ---" >&2
  git -C /workspace log --oneline -3 2>&1 >&2 || true
  echo "--- git remote -v ---" >&2
  git -C /workspace remote -v 2>&1 >&2 || true
  echo "--- /workspace/templates ---" >&2
  ls -la /workspace/templates/ 2>&1 | head -20 >&2 || true
}

if [ ! -f "/workspace/validate_custom.R" ]; then
  echo "validate_custom: /workspace/validate_custom.R missing — soft-skipping layer-2 validation" >&2
  dump_workspace_state
  emit_skipped "no study-specific validation script in workspace (validate_custom.R missing)"
  exit 0
fi

if [ ! -f "$RULES" ]; then
  echo "validate_custom: rules file $RULES missing — soft-skipping layer-2 validation" >&2
  dump_workspace_state
  emit_skipped "no study-specific validation rules in workspace ($RULES missing)"
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
