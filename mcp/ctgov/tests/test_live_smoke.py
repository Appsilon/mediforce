"""Live smoke tests — hit the real ClinicalTrials.gov API. Opt in with `pytest -m live`."""

import pytest

from ctgov_mcp.client import CtGovClient, CtGovNotFound

pytestmark = pytest.mark.live


@pytest.fixture(scope="module")
def client():
    c = CtGovClient()
    yield c
    c.close()


def test_get_study_live(client):
    rec = client.get("studies/NCT04280705", {"fields": "IdentificationModule"})
    assert rec["protocolSection"]["identificationModule"]["nctId"] == "NCT04280705"


def test_version_live(client):
    v = client.get("version")
    assert "dataTimestamp" in v and "apiVersion" in v


def test_search_live(client):
    page = client.get(
        "studies",
        {"query.cond": "diabetes", "pageSize": 2, "countTotal": "true", "fields": "NCTId"},
    )
    assert page["totalCount"] > 0
    assert len(page["studies"]) == 2
    assert "nextPageToken" in page


def test_unknown_nct_live(client):
    with pytest.raises(CtGovNotFound):
        client.get("studies/NCT99999999")
