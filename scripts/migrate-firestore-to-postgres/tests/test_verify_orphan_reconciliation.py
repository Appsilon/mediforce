"""F8 — verify.py reconciles per-table orphan-skipped counts.

`main.py` writes `migration_log.json` with `{table: {inserted, skipped, errors}}`.
Orphan-skipped rows (e.g., audit_events with no resolvable workspace) increment
`errors` and don't land in Postgres. `verify.py` then sees `fs > pg` and
incorrectly fails the verification.

Fix: `verify.py` exposes
  - `load_skipped_counts(path) -> dict[str, int]` reading per-table `errors`
  - `compute_table_passed(fs_count, pg_count, skipped, mismatched) -> bool`
    where pass = (fs_count == pg_count + skipped) and (mismatched == 0).
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from verify import compute_table_passed, load_skipped_counts


# ---------- compute_table_passed --------------------------------------------


def test_orphan_reconcile_passes_when_pg_plus_skipped_equals_fs():
    assert compute_table_passed(fs_count=100, pg_count=95, skipped=5, mismatched=0) is True


def test_genuine_loss_still_fails():
    # 5 rows accounted for as orphans, but 5 more went missing.
    assert (
        compute_table_passed(fs_count=100, pg_count=90, skipped=5, mismatched=0) is False
    )


def test_field_mismatch_fails_even_with_matching_counts():
    assert (
        compute_table_passed(fs_count=100, pg_count=100, skipped=0, mismatched=3) is False
    )


def test_exact_match_no_skipped_passes():
    assert (
        compute_table_passed(fs_count=42, pg_count=42, skipped=0, mismatched=0) is True
    )


def test_pg_count_exceeds_fs_fails():
    # Postgres should never have *more* rows than Firestore + skipped.
    assert (
        compute_table_passed(fs_count=10, pg_count=15, skipped=0, mismatched=0) is False
    )


# ---------- load_skipped_counts ---------------------------------------------


def test_load_skipped_counts_missing_file_returns_empty_dict(tmp_path):
    missing = tmp_path / "does_not_exist.json"

    result = load_skipped_counts(str(missing))

    assert result == {}


def test_load_skipped_counts_parses_per_table_errors(tmp_path):
    log_file = tmp_path / "migration_log.json"
    log_file.write_text(
        json.dumps(
            {
                "audit_events": {"inserted": 95, "skipped": 0, "errors": 5},
                "agent_runs": {"inserted": 200, "skipped": 0, "errors": 0},
                "human_tasks": {"inserted": 10, "skipped": 2, "errors": 3},
            }
        )
    )

    result = load_skipped_counts(str(log_file))

    # Per spec, "skipped" in verify means orphan-dropped rows, i.e. main.py's
    # `errors` field.
    assert result == {
        "audit_events": 5,
        "agent_runs": 0,
        "human_tasks": 3,
    }


def test_load_skipped_counts_handles_malformed_entries(tmp_path):
    log_file = tmp_path / "migration_log.json"
    log_file.write_text(
        json.dumps(
            {
                "ok_table": {"inserted": 1, "skipped": 0, "errors": 2},
                "weird_table": {},  # no errors field
            }
        )
    )

    result = load_skipped_counts(str(log_file))

    assert result == {"ok_table": 2, "weird_table": 0}
