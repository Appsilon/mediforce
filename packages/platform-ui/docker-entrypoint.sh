#!/bin/bash
set -euo pipefail

# Replace __NEXT_PUBLIC_*__ build-time placeholders with runtime env vars.
# This lets a single Docker image serve any deployment (different domains) —
# config is injected at container start, not baked at build time.
#
# Only runs when placeholders are detected (i.e. image was built without
# real values). Local `docker compose build` with real build args skips this.

NEXT_DIR="/app/packages/platform-ui/.next"
SERVER_JS="/app/packages/platform-ui/server.js"

needs_replacement=false
if grep -rq '__NEXT_PUBLIC_' "$NEXT_DIR" 2>/dev/null || \
   grep -q '__NEXT_PUBLIC_' "$SERVER_JS" 2>/dev/null; then
  needs_replacement=true
fi

if [ "$needs_replacement" = true ]; then
  echo "[entrypoint] Injecting runtime NEXT_PUBLIC_* config..."

  env | grep '^NEXT_PUBLIC_' | while IFS='=' read -r name value; do
    placeholder="__${name}__"
    # Escape sed special chars in value
    escaped_value=$(printf '%s\n' "$value" | sed 's/[&/\|]/\\&/g')
    # Replace in client bundles (.next/static/) AND server chunks (.next/server/)
    # -type f excludes symlinks (node_modules contains .js symlinks; sed -i on a
    # symlink fails and aborts the rest of the batch, leaving later files untouched)
    find "$NEXT_DIR" -name '*.js' -type f -exec sed -i "s|${placeholder}|${escaped_value}|g" {} + 2>/dev/null || true
    [ -f "$SERVER_JS" ] && sed -i "s|${placeholder}|${escaped_value}|g" "$SERVER_JS" 2>/dev/null || true
  done

  echo "[entrypoint] Config injected"
fi

exec "$@"
