"""Open a PR with proposed validation rules.

Runs as the `new-rules-branch` script step in the landing-zone workflow.
Triggered by the `approve` verdict from the upstream `propose-rules` agent
step. Idempotent under retry (branch + PR creation both detect existing
state and short-circuit).

Inputs:
  /output/input.json
    Carries the upstream `propose-rules` step output:
      proposedRules:    [...]
      proposedRuleIds:  [...]
      prTitle:          string
      prBody:           string
      summary:          string

  /workspace/validation-rules.yaml  — modified file (rules appended by upstream)

  env:
    GITHUB_TOKEN     — token with `contents:write` + `pull-requests:write`
                       on WORKSPACE_REMOTE
    WORKSPACE_REMOTE — `<owner>/<repo>` (e.g. Appsilon/mediforce-landing-zone-study-demo)
    RUN_ID           — short identifier surfaced into branch name; if absent
                       the script falls back to the process instance id from
                       /output/input.json

Outputs:
  /output/result.json
    {
      "prCreated": bool,
      "prUrl":     string | null,    # null if skipped
      "branch":    string | null,
      "reason":    string | null     # filled when skipped
    }

Behaviour:
  - Fresh shallow clone of WORKSPACE_REMOTE main into /tmp/repo
  - Copies validation-rules.yaml from /workspace into the clone
  - If the file is byte-identical to main, exits 0 with prCreated=false
    (no commit, no push, no PR)
  - Otherwise creates branch `rules/<runId>`, commits as `Mediforce Bot`,
    pushes, then POSTs to the GitHub REST API to open the PR
  - If the branch already exists upstream (retry), force-pushes the new
    head; if a PR already exists for the head→base pair, returns that PR
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path

WORKSPACE = Path(os.environ.get("WORKSPACE_DIR", "/workspace"))
OUTPUT = Path(os.environ.get("OUTPUT_DIR", "/output"))
CLONE_DIR = Path(os.environ.get("CLONE_DIR", "/tmp/repo"))
RULES_FILE = "validation-rules.yaml"
COMMIT_AUTHOR_NAME = "Mediforce Bot"
COMMIT_AUTHOR_EMAIL = "bot@mediforce.ai"


def fail(message: str) -> None:
    """Write a failure result.json and exit non-zero."""
    write_result({"prCreated": False, "prUrl": None, "branch": None, "reason": f"error: {message}"})
    print(f"open_rules_pr: {message}", file=sys.stderr)
    sys.exit(1)


def write_result(payload: dict) -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "result.json").write_text(json.dumps(payload, indent=2), encoding="utf-8")


def run(cmd: list[str], cwd: Path | None = None, check: bool = True, env: dict | None = None) -> subprocess.CompletedProcess:
    """Run a command and capture output. Surfaces stderr on failure."""
    result = subprocess.run(
        cmd,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        env=env if env is not None else os.environ.copy(),
    )
    if check and result.returncode != 0:
        sys.stderr.write(f"$ {' '.join(cmd)}\n{result.stdout}{result.stderr}\n")
        raise subprocess.CalledProcessError(result.returncode, cmd, result.stdout, result.stderr)
    return result


def github_api(
    method: str,
    path: str,
    token: str,
    body: dict | None = None,
) -> tuple[int, dict | None]:
    """Issue a request to api.github.com using urllib (no extra deps)."""
    url = f"https://api.github.com{path}"
    data_bytes: bytes | None = None
    if body is not None:
        data_bytes = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data_bytes, method=method)
    req.add_header("Authorization", f"token {token}")
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    if data_bytes is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req) as resp:
            payload_text = resp.read().decode("utf-8")
            return resp.status, json.loads(payload_text) if payload_text else None
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode("utf-8") if exc.fp else ""
        try:
            return exc.code, json.loads(body_text) if body_text else None
        except json.JSONDecodeError:
            return exc.code, {"error": body_text}


def main() -> None:
    token = os.environ.get("GITHUB_TOKEN", "").strip()
    remote = os.environ.get("WORKSPACE_REMOTE", "").strip()
    if not token:
        fail("GITHUB_TOKEN not set")
    if not remote or "/" not in remote:
        fail("WORKSPACE_REMOTE must be set to '<owner>/<repo>'")

    input_path = OUTPUT / "input.json"
    if not input_path.exists():
        fail("/output/input.json missing — upstream step did not produce input")

    try:
        step_input = json.loads(input_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"could not parse /output/input.json: {exc}")
        return  # unreachable, satisfies type checker

    pr_title = step_input.get("prTitle") or "Add proposed validation rules"
    pr_body = step_input.get("prBody") or "Auto-generated by the landing-zone workflow."
    proposed_ids = step_input.get("proposedRuleIds") or []

    run_id = (
        os.environ.get("RUN_ID")
        or step_input.get("runId")
        or step_input.get("processInstanceId")
        or ""
    )
    if not run_id:
        fail("could not determine runId from env or step input")
    branch = f"rules/{run_id}"

    rules_src = WORKSPACE / RULES_FILE
    if not rules_src.exists():
        fail(f"{RULES_FILE} missing in /workspace — upstream step did not write it")

    # If upstream produced no changes (proposedRuleIds == [] AND file unchanged
    # against main), skip cleanly. We check the file content after cloning.
    if CLONE_DIR.exists():
        shutil.rmtree(CLONE_DIR)
    CLONE_DIR.mkdir(parents=True)

    clone_url = f"https://x-access-token:{token}@github.com/{remote}.git"
    try:
        run(["git", "clone", "--depth", "1", clone_url, str(CLONE_DIR)])
    except subprocess.CalledProcessError as exc:
        fail(f"git clone failed: {exc.stderr.strip()[-400:]}")

    # Compare new file against the clone's main copy. If identical, no PR.
    rules_dst = CLONE_DIR / RULES_FILE
    if rules_dst.exists() and rules_src.read_bytes() == rules_dst.read_bytes():
        write_result(
            {
                "prCreated": False,
                "prUrl": None,
                "branch": branch,
                "reason": "no-changes",
                "proposedRuleIds": proposed_ids,
            }
        )
        print(f"open_rules_pr: validation-rules.yaml unchanged vs main — skipping PR", file=sys.stderr)
        return

    # Stage the change on a new branch.
    run(["git", "checkout", "-b", branch], cwd=CLONE_DIR)
    shutil.copyfile(rules_src, rules_dst)

    git_env = os.environ.copy()
    git_env["GIT_AUTHOR_NAME"] = COMMIT_AUTHOR_NAME
    git_env["GIT_AUTHOR_EMAIL"] = COMMIT_AUTHOR_EMAIL
    git_env["GIT_COMMITTER_NAME"] = COMMIT_AUTHOR_NAME
    git_env["GIT_COMMITTER_EMAIL"] = COMMIT_AUTHOR_EMAIL

    run(["git", "add", RULES_FILE], cwd=CLONE_DIR, env=git_env)

    # `git diff --cached --quiet` returns 1 if there is staged change, 0 if none.
    diff_check = run(
        ["git", "diff", "--cached", "--quiet"],
        cwd=CLONE_DIR,
        check=False,
        env=git_env,
    )
    if diff_check.returncode == 0:
        write_result(
            {
                "prCreated": False,
                "prUrl": None,
                "branch": branch,
                "reason": "no-staged-changes",
                "proposedRuleIds": proposed_ids,
            }
        )
        print(f"open_rules_pr: nothing staged after copy — skipping", file=sys.stderr)
        return

    commit_message = f"Proposed validation rules from run {run_id}"
    run(["git", "commit", "-m", commit_message], cwd=CLONE_DIR, env=git_env)

    # Push (force, in case we are retrying after a partial run).
    run(["git", "push", "--force", "-u", "origin", branch], cwd=CLONE_DIR, env=git_env)

    # Open or fetch the PR.
    create_status, create_body = github_api(
        "POST",
        f"/repos/{remote}/pulls",
        token,
        {"title": pr_title, "body": pr_body, "head": branch, "base": "main"},
    )
    if create_status == 201 and isinstance(create_body, dict):
        pr_url = create_body.get("html_url")
    elif create_status == 422:
        # Most likely "A pull request already exists for X:branch" — fetch it.
        list_status, list_body = github_api(
            "GET",
            f"/repos/{remote}/pulls?head={remote.split('/')[0]}:{branch}&state=open",
            token,
        )
        if list_status == 200 and isinstance(list_body, list) and list_body:
            pr_url = list_body[0].get("html_url")
        else:
            fail(
                f"PR creation returned 422 and no existing PR found "
                f"(list status {list_status})"
            )
            return
    else:
        fail(
            f"PR creation failed: status {create_status}, body {create_body!r}"
        )
        return

    write_result(
        {
            "prCreated": True,
            "prUrl": pr_url,
            "branch": branch,
            "reason": None,
            "proposedRuleIds": proposed_ids,
        }
    )
    print(f"open_rules_pr: opened {pr_url}", file=sys.stderr)


if __name__ == "__main__":
    main()
