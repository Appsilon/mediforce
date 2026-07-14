import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


def load_fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


@pytest.fixture
def study_record():
    return load_fixture("study_NCT04280705.json")


@pytest.fixture
def search_page():
    return load_fixture("search_diabetes.json")


@pytest.fixture
def version_payload():
    return load_fixture("version.json")
