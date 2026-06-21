"""Live smoke tests — hit the real CDISC Library API. Opt in with `pytest -m live`.

Requires a valid CDISC_API_KEY in the environment.
"""

import os

import pytest

from cdisclib_mcp.client import CdiscLibraryClient, CdiscNotFound

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def client():
    if not os.environ.get("CDISC_API_KEY"):
        pytest.skip("CDISC_API_KEY not set")
    c = CdiscLibraryClient()
    yield c
    c.close()


def test_products_live(client):
    d = client.get("mdr/products")
    assert "_links" in d
    assert "terminology" in d["_links"]


def test_biomedical_concepts_index_live(client):
    d = client.get("cosmos/v2/mdr/bc/biomedicalconcepts")
    assert d["_links"]["biomedicalConcepts"]


def test_biomedical_concept_detail_live(client):
    d = client.get("cosmos/v2/mdr/bc/biomedicalconcepts/C105585")
    assert d["conceptId"] == "C105585"
    assert "dataElementConcepts" in d


def test_dataset_specialization_live(client):
    d = client.get("cosmos/v2/mdr/specializations/sdtm/datasetspecializations/SYSBP")
    assert d["domain"] == "VS"
    assert d["variables"]


def test_ct_packages_live(client):
    d = client.get("mdr/ct/packages")
    assert d["_links"]["packages"]


def test_codelist_root_live(client):
    # Root view = version navigation (no terms); lists every package the codelist appears in.
    d = client.get("mdr/root/ct/sdtmct/codelists/C66741")
    assert d["_links"]["versions"]


def test_codelist_packaged_terms_live(client):
    d = client.get("mdr/ct/packages/sdtmct-2026-03-27/codelists/C66741")
    assert d["conceptId"] == "C66741"
    assert d["terms"]


def test_search_live(client):
    d = client.get("mdr/search", {"q": "glucose", "pageSize": 2})
    assert d["totalHits"] > 0
    assert len(d["hits"]) == 2


def test_unknown_concept_live(client):
    with pytest.raises(CdiscNotFound):
        client.get("cosmos/v2/mdr/bc/biomedicalconcepts/NOTREAL")
