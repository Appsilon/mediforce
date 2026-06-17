"""Offline tests for the MCP tool wrappers.

A recording fake client is substituted for the module-level client so we can assert how
each tool maps its arguments to API paths/params, without hitting the network.
"""

import pytest

from ctgov_mcp import server


class FakeClient:
    """Records (path, params) and returns a canned payload."""

    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params or {}))
        return self.payload


@pytest.fixture
def patch_client(monkeypatch):
    def _install(payload):
        fake = FakeClient(payload)
        monkeypatch.setattr(server, "_client", fake)
        # Disable snapshotting side effects during tool tests.
        monkeypatch.setattr(server, "write_snapshot", lambda *a, **k: None)
        return fake

    return _install


def test_get_study_builds_path_and_params(patch_client, study_record):
    fake = patch_client(study_record)
    result = server.get_study("nct04280705", fields="IdentificationModule")
    assert result["protocolSection"]["identificationModule"]["nctId"] == "NCT04280705"
    path, params = fake.calls[0]
    assert path == "studies/NCT04280705"  # uppercased
    assert params["fields"] == "IdentificationModule"
    assert params["markupFormat"] == "markdown"
    assert params["format"] == "json"


def test_get_study_rejects_bad_id(patch_client, study_record):
    patch_client(study_record)
    with pytest.raises(ValueError):
        server.get_study("12345")


def test_search_studies_maps_query_params(patch_client, search_page):
    fake = patch_client(search_page)
    result = server.search_studies(cond="diabetes", page_size=2, count_total=True, status="RECRUITING")
    assert "studies" in result
    path, params = fake.calls[0]
    assert path == "studies"
    assert params["query.cond"] == "diabetes"
    assert params["filter.overallStatus"] == "RECRUITING"
    assert params["pageSize"] == 2
    assert params["countTotal"] == "true"


def test_search_studies_clamps_page_size(patch_client, search_page):
    fake = patch_client(search_page)
    server.search_studies(cond="x", page_size=99999)
    assert fake.calls[0][1]["pageSize"] == 1000


def test_list_study_documents_extracts_section(patch_client, study_record):
    fake = patch_client(study_record)
    docs = server.list_study_documents("NCT04280705")
    # fixture was captured with DocumentSection; tool returns that subsection.
    assert docs == study_record.get("documentSection", {})
    assert fake.calls[0][1]["fields"] == "DocumentSection"


def test_get_api_version_passthrough(patch_client, version_payload):
    patch_client(version_payload)
    v = server.get_api_version()
    assert "dataTimestamp" in v
