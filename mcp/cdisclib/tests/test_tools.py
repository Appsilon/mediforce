"""Offline tests for the MCP tool wrappers.

A recording fake client is substituted for the module-level client so we can assert how
each tool maps its arguments to API paths/params, without hitting the network.
"""

import pytest

from cdisclib_mcp import server
from cdisclib_mcp.client import CdiscNotFound


class FakeClient:
    """Records (path, params) and returns a canned payload (or raises a queued error)."""

    def __init__(self, payload, error=None):
        self.payload = payload
        self.error = error
        self.calls = []

    def get(self, path, params=None):
        self.calls.append((path, params or {}))
        if self.error is not None:
            raise self.error
        return self.payload


@pytest.fixture
def patch_client(monkeypatch):
    def _install(payload, error=None):
        fake = FakeClient(payload, error=error)
        monkeypatch.setattr(server, "_client", fake)
        # Disable snapshotting side effects during tool tests.
        monkeypatch.setattr(server, "write_snapshot", lambda *a, **k: None)
        return fake

    return _install


def test_search_maps_params(patch_client, search_page):
    fake = patch_client(search_page)
    result = server.search("glucose", page_size=2, start=3, type="Biomedical Concept")
    assert "hits" in result
    path, params = fake.calls[0]
    assert path == "mdr/search"
    assert params["q"] == "glucose"
    assert params["pageSize"] == 2
    assert params["start"] == 3
    assert params["type"] == "Biomedical Concept"


def test_search_clamps_paging(patch_client, search_page):
    fake = patch_client(search_page)
    server.search("x", page_size=0, start=0)
    _, params = fake.calls[0]
    assert params["pageSize"] == 1
    assert params["start"] == 1


def test_list_biomedical_concepts_path(patch_client, bc_list):
    fake = patch_client(bc_list)
    result = server.list_biomedical_concepts()
    assert "_links" in result
    assert fake.calls[0][0] == "cosmos/v2/mdr/bc/biomedicalconcepts"


def test_get_biomedical_concept_path(patch_client, bc_detail):
    fake = patch_client(bc_detail)
    result = server.get_biomedical_concept("  C105585 ")
    assert result["conceptId"] == "C105585"
    assert fake.calls[0][0] == "cosmos/v2/mdr/bc/biomedicalconcepts/C105585"


def test_get_biomedical_concept_not_found_maps_to_valueerror(patch_client):
    patch_client(None, error=CdiscNotFound("404"))
    with pytest.raises(ValueError):
        server.get_biomedical_concept("NOPE")


def test_list_dataset_specializations_path(patch_client, datasetspec_list):
    fake = patch_client(datasetspec_list)
    server.list_dataset_specializations()
    assert fake.calls[0][0] == "cosmos/v2/mdr/specializations/sdtm/datasetspecializations"


def test_get_dataset_specialization_path_and_shape(patch_client, datasetspec_detail):
    fake = patch_client(datasetspec_detail)
    result = server.get_dataset_specialization("SYSBP")
    assert result["domain"] == "VS"
    assert isinstance(result["variables"], list) and result["variables"]
    assert (
        fake.calls[0][0]
        == "cosmos/v2/mdr/specializations/sdtm/datasetspecializations/SYSBP"
    )


def test_get_dataset_specialization_not_found(patch_client):
    patch_client(None, error=CdiscNotFound("404"))
    with pytest.raises(ValueError):
        server.get_dataset_specialization("NOPE")


def test_list_ct_packages_path(patch_client, ct_packages):
    fake = patch_client(ct_packages)
    result = server.list_ct_packages()
    assert "_links" in result
    assert fake.calls[0][0] == "mdr/ct/packages"


def test_get_codelist_root_default(patch_client):
    fake = patch_client({"conceptId": "C66741"})
    server.get_codelist("C66741")
    assert fake.calls[0][0] == "mdr/root/ct/sdtmct/codelists/C66741"


def test_get_codelist_scope_override(patch_client):
    fake = patch_client({"conceptId": "C66741"})
    server.get_codelist("C66741", scope="cdashct")
    assert fake.calls[0][0] == "mdr/root/ct/cdashct/codelists/C66741"


def test_get_codelist_pinned_package(patch_client):
    fake = patch_client({"conceptId": "C66741"})
    server.get_codelist("C66741", package="sdtmct-2026-03-27")
    assert fake.calls[0][0] == "mdr/ct/packages/sdtmct-2026-03-27/codelists/C66741"


def test_get_codelist_not_found(patch_client):
    patch_client(None, error=CdiscNotFound("404"))
    with pytest.raises(ValueError):
        server.get_codelist("CNOPE")


def test_get_products_path(patch_client):
    fake = patch_client({"_links": {}})
    server.get_products()
    assert fake.calls[0][0] == "mdr/products"
