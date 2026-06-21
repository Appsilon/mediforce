import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def bc_list():
    return load_fixture("bc_list.json")


@pytest.fixture
def bc_detail():
    return load_fixture("bc_C105585.json")


@pytest.fixture
def datasetspec_list():
    return load_fixture("datasetspec_list.json")


@pytest.fixture
def datasetspec_detail():
    return load_fixture("datasetspec_SYSBP.json")


@pytest.fixture
def ct_packages():
    return load_fixture("ct_packages.json")


@pytest.fixture
def search_page():
    return load_fixture("search_glucose.json")
