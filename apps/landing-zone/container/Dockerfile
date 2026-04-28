# =============================================================================
# Landing Zone Script Container Image
#
# Used by `script-container` plugin steps in landing-zone-*.wd.json:
#   sftp-poll, validate-script, accept-delivery
#
# Includes:
#   - cdisc-rules-engine: CDISC CORE rules engine (Python library)
#   - core.py + resources: the CDISC CORE CLI entrypoint, cloned from upstream
#     (the pip package does not ship a console script — upstream ships core.py
#     at the repo root; we vendor it into /opt/cdisc together with the
#     resources/ directory it needs at runtime, including pre-built rule caches)
#   - paramiko:           SFTP client
#   - pyyaml:             study config parsing
#
# Invoke validation as:
#   python /opt/cdisc/core.py validate -s sdtmig -v 3-4 -dp <file.xpt> -o <out>
#
# Build:  docker build -f apps/landing-zone/container/Dockerfile \
#                     -t mediforce-script:landing-zone \
#                     apps/landing-zone
# =============================================================================

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

# Install the engine, paramiko (for SFTP), and pyyaml (for study config).
# The cdisc-rules-engine pip package matches the upstream `main` branch
# at the same version (0.15.0).
RUN pip install --no-cache-dir \
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
#   <site-packages>/cdisc_rules_engine/resources/
#                           — pre-built rule cache pickles read at startup
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
