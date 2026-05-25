#!/usr/bin/env python3
"""Smoke tests for check-gif-freshness.py.

Builds throw-away git repos in tmp dirs and runs the script against them.
Run directly: `python3 check-gif-freshness.test.py`.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-gif-freshness.py"


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args],
        cwd=repo,
        capture_output=True, text=True, check=True,
        env={**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t",
             "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"},
    )
    return result.stdout


def init_repo(repo: Path) -> None:
    git(repo, "init", "-q", "-b", "main")
    git(repo, "config", "commit.gpgsign", "false")
    (repo / "e2e" / "ui").mkdir(parents=True)
    (repo / "docs" / "features").mkdir(parents=True)
    (repo / "e2e" / "ui" / "existing.journey.ts").write_text("test('x', () => {});\n")
    (repo / "docs" / "features" / "existing.gif").write_bytes(b"GIF89a-existing")
    (repo / "README.md").write_text("base\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "base")
    git(repo, "checkout", "-q", "-b", "feature")


def run_script(repo: Path) -> int:
    result = subprocess.run(
        ["python3", str(SCRIPT), "main"],
        cwd=repo, capture_output=True, text=True,
    )
    sys.stdout.write(result.stdout)
    sys.stderr.write(result.stderr)
    return result.returncode


def case_add_then_revert_passes() -> None:
    """Add comment, then revert it: net diff is zero → script must exit 0."""
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        init_repo(repo)
        journey = repo / "e2e" / "ui" / "existing.journey.ts"
        original = journey.read_text()
        journey.write_text(original + "// comment\n")
        git(repo, "commit", "-aqm", "add comment")
        journey.write_text(original)
        git(repo, "commit", "-aqm", "revert comment")
        rc = run_script(repo)
        assert rc == 0, f"add-then-revert should pass, got rc={rc}"
        print("OK case_add_then_revert_passes")


def case_pure_add_without_gif_fails() -> None:
    """New journey file without GIF refresh → script must fail."""
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        init_repo(repo)
        (repo / "e2e" / "ui" / "new.journey.ts").write_text("test('y', () => {});\n")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "add new journey")
        rc = run_script(repo)
        assert rc != 0, f"pure add without GIF should fail, got rc={rc}"
        print("OK case_pure_add_without_gif_fails")


def case_add_with_gif_refresh_passes() -> None:
    """Journey change + later GIF refresh → script must exit 0."""
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        init_repo(repo)
        (repo / "e2e" / "ui" / "new.journey.ts").write_text("test('y', () => {});\n")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "add new journey")
        (repo / "docs" / "features" / "new.gif").write_bytes(b"GIF89a-new")
        git(repo, "add", ".")
        git(repo, "commit", "-qm", "refresh gif")
        rc = run_script(repo)
        assert rc == 0, f"add + gif refresh should pass, got rc={rc}"
        print("OK case_add_with_gif_refresh_passes")


def case_no_journey_change_passes() -> None:
    """Unrelated changes only → script must exit 0."""
    with tempfile.TemporaryDirectory() as td:
        repo = Path(td)
        init_repo(repo)
        (repo / "README.md").write_text("updated\n")
        git(repo, "commit", "-aqm", "readme")
        rc = run_script(repo)
        assert rc == 0, f"no journey change should pass, got rc={rc}"
        print("OK case_no_journey_change_passes")


if __name__ == "__main__":
    case_add_then_revert_passes()
    case_pure_add_without_gif_fails()
    case_add_with_gif_refresh_passes()
    case_no_journey_change_passes()
    print("\nAll tests passed.")
