# Golden Standard Workflow image
#
# This image is deliberately boring:
# - start from the Mediforce base image
# - install pinned runtime dependencies
# - copy workflow-owned scripts and MCP executables into stable paths
# - do not copy secrets or workflow graph semantics

FROM mediforce-golden-image

RUN apt-get update \
    && apt-get install -y --no-install-recommends jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir --break-system-packages \
    "pydantic==2.11.7"

COPY scripts/ /opt/golden-standard/scripts/
COPY mcp/ /opt/golden-standard/mcp/

WORKDIR /workspace
