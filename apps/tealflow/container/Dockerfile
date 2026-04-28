# =============================================================================
# TealFlow Agent Image
#
# Extends mediforce-golden-image with:
#   - tealflow-mcp:              MCP server for Teal app building
#   - teal + teal.modules.*:     Interactive clinical trial exploration framework
#   - renv:                      R environment reproducibility
#
# Build:  docker build -t mediforce-agent:tealflow .
# =============================================================================

FROM mediforce-golden-image

# Install tealflow-mcp (Python MCP server)
# --ignore-installed avoids conflict with Debian-managed packaging module
RUN pip3 install --no-cache-dir --break-system-packages --ignore-installed tealflow-mcp

# Install teal R packages
RUN install2.r --error --skipinstalled \
    renv \
    shiny \
    teal \
    teal.modules.general \
    teal.modules.clinical

# Copy sample ADaM datasets for testing
COPY sample_data/ /data/sample/
