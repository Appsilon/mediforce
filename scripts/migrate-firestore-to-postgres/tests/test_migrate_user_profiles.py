"""Characterization tests for main.migrate_user_profiles row mapping.

`user_profiles` carries only `must_change_password` from the Firestore
`users/{uid}` doc; the doc id is the uid (ADR-0001 final cutover, #534).
A missing or non-`True` flag must default to `False`. The dry-run path
performs no Postgres write, so a MagicMock connection is enough.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from main import migrate_user_profiles

from tests.conftest import FakeDoc


def test_dry_run_maps_must_change_password_flag(fake_fs, caplog):
    users = [
        FakeDoc("uid-true", {"mustChangePassword": True}),
        FakeDoc("uid-false", {"mustChangePassword": False}),
        FakeDoc("uid-missing", {}),
        FakeDoc("uid-truthy-nonbool", {"mustChangePassword": "yes"}),
    ]
    fs = fake_fs({"users": users})

    with caplog.at_level("INFO"):
        result = migrate_user_profiles(fs, MagicMock(), dry_run=True)

    # Dry-run never writes.
    assert result == {"inserted": 0, "skipped": 0, "errors": 0}
    # First mapped row reflects the doc id as uid + strict `is True` check.
    assert "user_profiles" in caplog.text
    assert "'uid': 'uid-true'" in caplog.text
    assert "'must_change_password': True" in caplog.text


def test_dry_run_with_empty_collection_logs_none(fake_fs, caplog):
    fs = fake_fs({"users": []})

    with caplog.at_level("INFO"):
        result = migrate_user_profiles(fs, MagicMock(), dry_run=True)

    assert result == {"inserted": 0, "skipped": 0, "errors": 0}
