#!/bin/bash
# Copy generate-adam outputs from mock data to /output/
mkdir -p /output/adam/code /output/adam/data
cp /mock-data/adam/adam-spec.md /output/adam/
cp /mock-data/adam/code/*.R /output/adam/code/
cp /mock-data/adam/data/*.csv /output/adam/data/ 2>/dev/null || true
cp /mock-data/adam/data/*.json /output/adam/data/ 2>/dev/null || true
cp /mock-data/adam/issues.md /output/adam/ 2>/dev/null || true
echo "[mock] Copied adam/ directory (spec, R scripts, data)" >&2
