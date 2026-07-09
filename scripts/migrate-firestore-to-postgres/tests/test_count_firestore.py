"""Characterization tests for verify.count_firestore.

Cover the B3 fix (inline-array `ia:coworkSessions:turns`) and the B4 fix
(map-keys counting for `custom:namespaceSecrets` / `custom:workflowSecrets`).
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

from verify import count_firestore

from tests.conftest import FakeDoc


# ---------- B3 — ia:coworkSessions:turns ------------------------------------


def test_b3_counts_sum_of_turns_array_lengths(fake_fs):
    sessions = [
        FakeDoc("s1", {"turns": ["a", "b"]}),
        FakeDoc("s2", {"turns": []}),
        FakeDoc("s3", {"turns": ["c", "d", "e"]}),
    ]
    fs = fake_fs({"coworkSessions": sessions})

    assert count_firestore(fs, "ia:coworkSessions:turns") == 5


def test_b3_session_with_no_turns_key_counts_as_zero(fake_fs):
    sessions = [
        FakeDoc("s1", {"turns": ["a"]}),
        FakeDoc("s2", {}),  # no `turns` key at all
        FakeDoc("s3", {"turns": None}),  # explicit None
    ]
    fs = fake_fs({"coworkSessions": sessions})

    assert count_firestore(fs, "ia:coworkSessions:turns") == 1


# ---------- B4 — custom:namespaceSecrets ------------------------------------


def _ns_doc_with_secrets(
    handle: str, secrets: dict[str, Any] | None, *, config_exists: bool = True
) -> FakeDoc:
    """Build a namespace doc whose sub-collection contains a `_config` doc.

    `_count_namespace_secrets` calls
        ns.reference.collection("namespaceSecrets").document("_config").get()
    so we wire `reference.collection().document().get()` to return a snapshot.
    """
    doc = FakeDoc(handle, {"handle": handle})
    config_snapshot = MagicMock()
    config_snapshot.exists = config_exists
    config_snapshot.to_dict.return_value = (
        {"secrets": secrets} if secrets is not None else {}
    )
    sub = MagicMock()
    sub.document.return_value.get.return_value = config_snapshot
    doc.reference.collection.return_value = sub
    return doc


def test_b4_namespace_secrets_counts_map_keys_not_docs(fake_fs):
    nses = [
        _ns_doc_with_secrets("a", {"k1": "v1", "k2": "v2"}),
        _ns_doc_with_secrets("b", {"only": "one"}),
        _ns_doc_with_secrets("c", {"x": "1", "y": "2", "z": "3"}),
    ]
    fs = fake_fs({"namespaces": nses})

    # 2 + 1 + 3 = 6 keys across 3 namespaces.
    assert count_firestore(fs, "custom:namespaceSecrets") == 6


def test_b4_namespace_secrets_empty_or_missing_counts_zero(fake_fs):
    nses = [
        _ns_doc_with_secrets("a", {}),          # secrets: {}
        _ns_doc_with_secrets("b", None),         # no `secrets` key at all
        _ns_doc_with_secrets("c", None, config_exists=False),  # no _config doc
    ]
    fs = fake_fs({"namespaces": nses})

    assert count_firestore(fs, "custom:namespaceSecrets") == 0


# ---------- B4 — custom:workflowSecrets -------------------------------------


def _ns_doc_with_workflow_secrets(
    handle: str, workflows: dict[str, dict[str, Any]]
) -> FakeDoc:
    """Build a namespace doc whose `workflowSecrets` sub-collection contains
    one doc per workflow, each with a `secrets` map.

    `_count_workflow_secrets` calls
        for wf_doc in ns.reference.collection("workflowSecrets").stream():
            total += len(wf_doc.to_dict().get('secrets') or {})
    """
    doc = FakeDoc(handle, {"handle": handle})
    wf_docs = []
    for wf_name, secrets in workflows.items():
        wf_snapshot = MagicMock()
        wf_snapshot.id = wf_name
        wf_snapshot.to_dict.return_value = {"secrets": secrets}
        wf_docs.append(wf_snapshot)
    sub = MagicMock()
    sub.stream.return_value = iter(wf_docs)
    doc.reference.collection.return_value = sub
    return doc


def test_b4_workflow_secrets_fans_out_keys_per_workflow(fake_fs):
    nses = [
        _ns_doc_with_workflow_secrets(
            "a",
            {"wf1": {"k1": "v1", "k2": "v2"}, "wf2": {"x": "1"}},
        ),
        _ns_doc_with_workflow_secrets(
            "b",
            {"only_wf": {"a": "1", "b": "2", "c": "3"}},
        ),
    ]
    fs = fake_fs({"namespaces": nses})

    # ns a: 2 + 1 = 3, ns b: 3 → total 6
    assert count_firestore(fs, "custom:workflowSecrets") == 6


def test_b4_workflow_secrets_empty_secrets_counts_zero(fake_fs):
    nses = [
        _ns_doc_with_workflow_secrets("a", {"wf1": {}}),  # empty
        _ns_doc_with_workflow_secrets("b", {}),            # no workflow docs
    ]
    fs = fake_fs({"namespaces": nses})

    assert count_firestore(fs, "custom:workflowSecrets") == 0
