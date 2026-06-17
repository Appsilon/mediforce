#!/usr/bin/env bash
# Vercel ignoreCommand helper.
# Exit 0 = skip build, exit 1 = build.
#
# Only main is auto-deployed via Git integration; skip every other branch
# (on-demand previews go through the `/deploy` PR-comment workflow, which uses
# the Vercel CLI and bypasses this ignoreCommand).
# On main, additionally skip doc-only changes.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ]; then
  exit 0
fi

git diff --quiet HEAD^ HEAD -- . \
  ':!docs' ':!skills' ':!.claude' ':!agents' ':!.planning' \
  ':!LICENSE' ':(exclude,glob)*.md'
