#!/usr/bin/env bash
# Validate the tabulated SDTM datasets with the CDISC Rules Engine (CORE), offline (bundled cache).
# CORE publishes conformance rules for SDTMIG/SENDIG/ADaMIG/TIG/USDM — NOT CDASH — so we validate
# the SDTM tabulation of our synthetic CDASH (see ../06_cdash_to_sdtm.py).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ENGINE="$(cd "$HERE/../../cdisc-rules-engine" && pwd)"
cd "$ENGINE"
.venv/bin/python core.py validate \
  -s sdtmig -v 3-4 \
  -d "$HERE/../06_sdtm/datasets" -ft csv \
  -ct sdtmct-2026-03-27 \
  -ca resources/cache \
  -o "$HERE/core_sdtmig34" -of JSON \
  -l error -p percents
