"""Shared fixtures for cutover-script tests.

Tests run against in-memory fakes of the Firestore client — no real
Firestore / Postgres connection is ever made. Keep fakes minimal and only
implement the surface area used by main.py / verify.py.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import pytest

# Make verify.py / main.py importable as top-level modules.
SCRIPT_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))


# Stub out heavy runtime deps so tests don't require firebase-admin/psycopg2
# to be installed locally. The scripts only use these for live connections,
# which we never make in tests.
def _stub_module(name: str, **attrs: Any) -> None:
    if name in sys.modules:
        return
    mod = MagicMock()
    for k, v in attrs.items():
        setattr(mod, k, v)
    sys.modules[name] = mod


_stub_module("firebase_admin")
_stub_module("firebase_admin.credentials")
_stub_module("firebase_admin.firestore")
_stub_module("psycopg2")
_stub_module("psycopg2.extras")
_stub_module("google")
_stub_module("google.cloud")
_stub_module("google.cloud.firestore")


class FakeDoc:
    """Mimics a Firestore DocumentSnapshot just enough for verify.py."""

    def __init__(self, doc_id: str, data: dict[str, Any] | None, *, exists: bool = True):
        self.id = doc_id
        self._data = data
        self.exists = exists
        # `reference.collection(name).document(id)` is used for sub-collections.
        self.reference = MagicMock()

    def to_dict(self) -> dict[str, Any] | None:
        return self._data


class FakeCollection:
    """Mimics fs.collection(name).stream()."""

    def __init__(self, docs: list[FakeDoc]):
        self._docs = docs

    def stream(self):
        return iter(self._docs)

    def document(self, doc_id: str) -> FakeDoc:
        for d in self._docs:
            if d.id == doc_id:
                return _Returnable(d)
        return _Returnable(FakeDoc(doc_id, None, exists=False))


class _Returnable:
    """Wrap a doc so `.get()` returns the snapshot (Firestore-style)."""

    def __init__(self, doc: FakeDoc):
        self._doc = doc

    def get(self) -> FakeDoc:
        return self._doc


class FakeFirestore:
    """Top-level fs handle. Map collection-name -> list[FakeDoc]."""

    def __init__(self, collections: dict[str, list[FakeDoc]] | None = None):
        self._collections = collections or {}

    def collection(self, name: str) -> FakeCollection:
        return FakeCollection(self._collections.get(name, []))

    def collection_group(self, name: str) -> FakeCollection:
        # Tests using collection_group should pass docs under a synthetic key.
        return FakeCollection(self._collections.get(f"cg:{name}", []))


@pytest.fixture
def fake_fs():
    """Factory: pass a {collection_name: [FakeDoc, ...]} dict."""

    def _make(collections: dict[str, list[FakeDoc]] | None = None) -> FakeFirestore:
        return FakeFirestore(collections)

    return _make
