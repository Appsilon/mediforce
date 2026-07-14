# =============================================================================
# Protocol-to-Synthetic-SDTM Agent Image
#
# Extends mediforce-golden-image (Python 3 + Claude Code CLI for the two AI
# steps) with the Python pipeline from the ct_to_synthetic_data repo:
#   - ctgov-mcp / cdisclib-mcp   MCP servers (ClinicalTrials.gov, CDISC Library)
#   - cdisc-rules-engine (CORE)  conformance validation, offline bundled cache
#   - test/0*.py                 numbered stage scripts (Stages 1-6)
#
# The image mirrors the source repo tree under /app because the stage scripts
# use repo-relative paths (mcp/cdisclib/src, ../../cdisc-rules-engine).
#
# Build:  python apps/protocol-to-synthetic-sdtm/container/build.py
#         (stages a lean context excluding .venv dirs, then docker build)
# =============================================================================

FROM mediforce-golden-image

# --- MCP servers: console scripts ctgov-mcp / cdisclib-mcp, and the cdisclib_mcp
#     package importable by the stage scripts (02_build_sdtm_spec.py) ---
COPY mcp /app/mcp
RUN pip3 install --no-cache-dir --break-system-packages /app/mcp/ctgov /app/mcp/cdisclib

# --- CORE (CDISC Rules Engine): install deps system-wide, then expose them at the
#     .venv/bin/python path that 07_core_report/run_core_validation.sh hard-codes ---
COPY cdisc-rules-engine /app/cdisc-rules-engine
RUN pip3 install --no-cache-dir --break-system-packages -r /app/cdisc-rules-engine/requirements.txt \
 && mkdir -p /app/cdisc-rules-engine/.venv/bin \
 && ln -s "$(command -v python3)" /app/cdisc-rules-engine/.venv/bin/python

# --- Numbered stage scripts ---
COPY test /app/test

WORKDIR /app/test
