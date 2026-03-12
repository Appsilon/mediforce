#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# Agent Container Entrypoint
#
# Clones a git repo, checks out a specific commit, creates a working branch,
# runs an arbitrary command, then commits and pushes the results.
#
# Required environment variables:
#   GIT_REPO      - SSH URL of the git repository
#   GIT_BRANCH    - Branch name to create/use for this agent's work
#   START_COMMIT  - Commit SHA to start from
#   STEP_ID       - Identifier for the pipeline step (used in commit message)
#   REPO_URL      - HTTPS browsable URL (e.g., https://github.com/org/repo)
#
# Usage:
#   entrypoint.sh <COMMAND>
#
# Example:
#   entrypoint.sh 'echo "hello world"'
#   entrypoint.sh 'claude -p --verbose "Generate ADaM datasets"'
# =============================================================================

if [[ $# -eq 0 ]]; then
  echo "Usage: entrypoint.sh <COMMAND> [ARGS...]" >&2
  exit 1
fi

WORKSPACE="/workspace"
OUTPUT_DIR="/output"
RESULT_FILE="${OUTPUT_DIR}/git-result.json"

# ---------------------------------------------------------------------------
# SSH deploy key configuration
# ---------------------------------------------------------------------------
configure_ssh() {
  local mounted_key="/root/.ssh/deploy_key"
  local key_path="/root/.ssh/_active_key"

  if [[ ! -f "${mounted_key}" ]]; then
    echo "ERROR: SSH deploy key not found at ${mounted_key}" >&2
    exit 1
  fi

  # Copy from read-only mount so we can set permissions
  mkdir -p /root/.ssh
  cp "${mounted_key}" "${key_path}"
  chmod 600 "${key_path}"

  cat > /root/.ssh/config <<SSH_CONFIG
Host *
  StrictHostKeyChecking no
  UserKnownHostsFile /dev/null
  IdentityFile ${key_path}
  LogLevel ERROR
SSH_CONFIG

  chmod 600 /root/.ssh/config
}

# ---------------------------------------------------------------------------
# Write the JSON result file
# ---------------------------------------------------------------------------
write_result() {
  local commit_sha="${1}"
  local branch="${2}"
  local changed_files="${3}"

  # Convert newline-separated file list to JSON array
  local files_json
  if [[ -z "${changed_files}" ]]; then
    files_json="[]"
  else
    files_json=$(echo "${changed_files}" | jq -R -s 'split("\n") | map(select(length > 0))')
  fi

  mkdir -p "${OUTPUT_DIR}"
  cat > "${RESULT_FILE}" <<EOF
{
  "commitSha": "${commit_sha}",
  "branch": "${branch}",
  "changedFiles": ${files_json},
  "repoUrl": "${REPO_URL:-${GIT_REPO}}"
}
EOF

  echo "Result written to ${RESULT_FILE}"
  cat "${RESULT_FILE}"
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
main() {
  echo "=== Agent Container Starting ==="
  echo "  GIT_REPO:     ${GIT_REPO}"
  echo "  GIT_BRANCH:   ${GIT_BRANCH}"
  echo "  START_COMMIT: ${START_COMMIT}"
  echo "  STEP_ID:      ${STEP_ID}"
  echo "  REPO_URL:     ${REPO_URL:-}"
  echo "  COMMAND:      $*"
  echo ""

  configure_ssh

  # Clone the repository
  echo "--- Cloning repository ---"
  git clone "${GIT_REPO}" "${WORKSPACE}"
  cd "${WORKSPACE}"

  # Configure git identity for commits
  git config user.email "agent@mediforce.dev"
  git config user.name "Mediforce Agent (${STEP_ID})"

  # Checkout the starting commit
  echo "--- Checking out start commit: ${START_COMMIT} ---"
  git checkout "${START_COMMIT}"

  # Create or checkout the working branch
  echo "--- Setting up branch: ${GIT_BRANCH} ---"
  if git ls-remote --exit-code --heads origin "${GIT_BRANCH}" > /dev/null 2>&1; then
    echo "Branch ${GIT_BRANCH} exists on remote, checking out"
    git checkout -B "${GIT_BRANCH}" "origin/${GIT_BRANCH}"
  else
    echo "Creating new branch ${GIT_BRANCH}"
    git checkout -b "${GIT_BRANCH}"
  fi

  # Copy input data to /data if mounted (optional)
  if [[ -d "/data" ]] && [[ "$(ls -A /data 2>/dev/null)" ]]; then
    echo "--- Input data available at /data ---"
  fi

  # Run the command
  echo ""
  echo "=== Running Command ==="
  echo "$*"
  echo "========================"
  echo ""

  "$@"
  local cmd_exit_code=$?

  echo ""
  echo "=== Command finished with exit code: ${cmd_exit_code} ==="
  echo ""

  if [[ ${cmd_exit_code} -ne 0 ]]; then
    echo "ERROR: Command failed with exit code ${cmd_exit_code}" >&2
    # Still write result with no changes so the orchestrator knows what happened
    write_result "${START_COMMIT}" "${GIT_BRANCH}" ""
    exit ${cmd_exit_code}
  fi

  # Stage all changes
  echo "--- Staging changes ---"
  git add -A

  # Check if there are changes to commit
  if git diff --cached --quiet; then
    echo "No file changes detected. Nothing to commit."
    write_result "${START_COMMIT}" "${GIT_BRANCH}" ""
  else
    echo "--- Committing changes ---"
    local commit_message="agent(${STEP_ID}): automated output

Step: ${STEP_ID}
Branch: ${GIT_BRANCH}
Start commit: ${START_COMMIT}"

    git commit -m "${commit_message}"

    local commit_sha
    commit_sha=$(git rev-parse HEAD)

    local changed_files
    changed_files=$(git diff --name-only HEAD~1)

    echo "--- Pushing to remote ---"
    git push origin "${GIT_BRANCH}"

    write_result "${commit_sha}" "${GIT_BRANCH}" "${changed_files}"
  fi

  echo ""
  echo "=== Agent Container Finished ==="
}

main "$@"
