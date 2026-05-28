#!/usr/bin/env bash
# Vercel ignoreCommand helper.
# Exit 0 = skip build, exit 1 = build.
#
# Build only on main, or when latest commit message contains [preview].
# On main, additionally skip doc-only changes.
set -euo pipefail

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"

if [ "${VERCEL_GIT_COMMIT_REF:-}" != "main" ] && ! git log -1 --pretty=%B | grep -q '\[preview\]'; then
  exit 0
fi

git diff --quiet HEAD^ HEAD -- . \
  ':!docs' ':!skills' ':!.claude' ':!agents' ':!.planning' \
  ':!LICENSE' ':(exclude,glob)*.md'
