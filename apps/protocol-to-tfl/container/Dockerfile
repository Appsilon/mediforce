# =============================================================================
# Protocol-to-TFL Agent Image
#
# Extends mediforce-golden-image with R packages for clinical trial data:
#   - haven:           Read/write SAS .xpt (SDTM/ADaM transport) files
#   - admiral:         ADaM dataset derivation (pharmaverse)
#   - pharmaversesdtm: Example SDTM data for development and testing
#
# Build:  docker build -t mediforce-agent:protocol-to-tfl .
# =============================================================================

FROM mediforce-golden-image

RUN install2.r --error --skipinstalled \
    haven \
    admiral \
    pharmaversesdtm
