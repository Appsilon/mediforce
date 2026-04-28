# =============================================================================
# Landing Zone Script Container Image
#
# Used by `script-container` plugin steps in landing-zone-*.wd.json:
#   sftp-poll, validate-script, accept-delivery
#
# Includes:
#   - cdisc-rules-engine: CDISC CORE rules engine (CLI: `core`)
#   - paramiko:           SFTP client
#   - pyyaml:             study config parsing
#
# Build:  docker build -f apps/landing-zone/container/Dockerfile \
#                     -t mediforce-script:landing-zone \
#                     apps/landing-zone
# =============================================================================

FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir \
    "cdisc-rules-engine>=0.13" \
    "paramiko>=3" \
    "pyyaml>=6"

COPY scripts/ /scripts/

WORKDIR /workspace
