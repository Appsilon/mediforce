#!/usr/bin/env bash
# Validate the generated SDTM datasets with the CDISC Rules Engine (CORE), offline (bundled cache).
# SDTM-first: CORE runs directly on the populated SDTM (no CDASH->SDTM tabulation). The engine
# consumes SAS V5 XPT / Dataset-JSON / XLSX (CSV input was dropped after engine 0.16.0), so the SDTM
# CSVs are exported to XPT v5 first (06_export_sdtm.py).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TEST="$(cd "$HERE/.." && pwd)"
# Cloned CDISC Rules Engine; override with CORE_ENGINE=/path/to/cdisc-rules-engine.
ENGINE="${CORE_ENGINE:-D:/repos/cdisc-rules-engine}"
# Engine venv Python (3.12). Prefer Windows layout, fall back to POSIX.
PY="$ENGINE/venv/Scripts/python.exe"; [ -x "$PY" ] || PY="$ENGINE/venv/bin/python"

# 1) Export the SDTM CSVs to XPT v5 (needs pyreadstat, which the engine venv has).
"$PY" "$TEST/06_export_sdtm.py"

# 2) Run CORE on the XPT, offline against the bundled rules/CT cache.
cd "$ENGINE"
"$PY" core.py validate \
  -s sdtmig -v 3-4 \
  -d "$TEST/06_sdtm_xpt" \
  -ct sdtmct-2026-03-27 \
  -ca resources/cache \
  -o "$HERE/core_sdtmig34" -of JSON \
  -l error -p percents
