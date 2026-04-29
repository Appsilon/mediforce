# =============================================================================
# Landing Zone Container Image
#
# Single image used by both step types in landing-zone-*.wd.json:
#   - script-container plugin (sftp-poll, validate-script, accept-delivery)
#   - claude-code-agent plugin (interpret-validation, draft-rejection-note)
#
# Extends mediforce-golden-image (R + tidyverse, Python 3, Node, Claude Code
# CLI, OpenCode CLI, git, SSH) and adds the CDISC validation toolchain plus
# the in-container step scripts. The agent steps don't use the CDISC libs
# directly but they read findings.json the script step writes — keeping
# both sides in one image avoids drift between script-time and agent-time
# views of the same data.
#
# Includes (on top of golden):
#   - cdisc-rules-engine: CDISC CORE rules engine (Python library)
#   - core.py + resources: the CDISC CORE CLI entrypoint, vendored from
#     upstream at a pinned commit (the pip package ships the library only;
#     core.py + scripts/ + resources/ live at the repo root)
#   - paramiko:           SFTP client
#   - pyyaml:             study config parsing
#
# Invoke validation as:
#   python /opt/cdisc/core.py validate -s sdtmig -v 3-4 -dp <file.xpt> -o <out>
#
# Build:  docker build -f apps/landing-zone/container/Dockerfile \
#                     -t mediforce-landing-zone:latest \
#                     apps/landing-zone
# =============================================================================

FROM mediforce-golden-image

# Install the engine, paramiko (for SFTP), and pyyaml (for study config).
# The cdisc-rules-engine pip package matches the upstream `main` branch
# at the same version (0.15.0).
RUN pip install --no-cache-dir --break-system-packages \
    "cdisc-rules-engine==0.15.0" \
    "paramiko>=3" \
    "pyyaml>=6"

# The pypi wheel ships the engine code but NOT the upstream repo's
# `core.py`, sibling `scripts/` package, or the `resources/` directory of
# pre-built rule pickles. We pin a specific commit (the one tagged 0.15.0
# in version.py on main) so the demo is reproducible, and copy those
# missing pieces into place.
#
# Layout:
#   /opt/cdisc/core.py      — CLI entrypoint (`python /opt/cdisc/core.py`)
#   /opt/cdisc/scripts/     — sibling python package core.py imports from
#   /opt/cdisc/resources/   — pre-built rule cache pickles read at startup
ARG CDISC_CORE_COMMIT=49f47862
RUN git clone https://github.com/cdisc-org/cdisc-rules-engine.git /tmp/cdisc-core \
    && cd /tmp/cdisc-core \
    && git checkout "${CDISC_CORE_COMMIT}" \
    && mkdir -p /opt/cdisc \
    && cp core.py /opt/cdisc/core.py \
    && cp -r scripts /opt/cdisc/scripts \
    # The engine resolves resource paths relative to the cwd of core.py
    # (`./resources/cache/...`). Drop the resources dir next to core.py so
    # the cache pickles are findable when running the CLI from /opt/cdisc.
    && cp -r resources /opt/cdisc/resources \
    && cd / \
    && rm -rf /tmp/cdisc-core

# core.py uses `from scripts.run_validation import ...` — make /opt/cdisc
# importable from any cwd so the engine works no matter where it's run.
ENV PYTHONPATH=/opt/cdisc

COPY scripts/ /scripts/

WORKDIR /workspace
