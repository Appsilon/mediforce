"""Offline tests for CtGovClient using httpx.MockTransport (no network)."""

import httpx
import pytest

from ctgov_mcp.client import CtGovClient, CtGovError, CtGovNotFound


def make_client(handler):
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport, base_url="https://x")
    # sleep is a no-op so retry tests don't actually wait.
    return CtGovClient(base_url="https://x", client=http, sleep=lambda _s: None)


def test_get_returns_json_and_drops_none_params():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        return httpx.Response(200, json={"ok": True})

    client = make_client(handler)
    result = client.get("studies", {"query.cond": "diabetes", "fields": None, "pageSize": 2})
    assert result == {"ok": True}
    # None-valued param is dropped; provided params are kept.
    assert "fields" not in seen["url"]
    assert "query.cond=diabetes" in seen["url"]
    assert "pageSize=2" in seen["url"]


def test_404_raises_not_found():
    client = make_client(lambda r: httpx.Response(404, text="not found"))
    with pytest.raises(CtGovNotFound):
        client.get("studies/NCT99999999")


def test_http_400_raises_ctgov_error():
    client = make_client(lambda r: httpx.Response(400, text="bad nctId"))
    with pytest.raises(CtGovError) as exc:
        client.get("studies/bogus")
    assert "400" in str(exc.value)


def test_retries_on_429_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "0"}, text="slow down")
        return httpx.Response(200, json={"ok": True})

    client = make_client(handler)
    assert client.get("version") == {"ok": True}
    assert calls["n"] == 3  # two 429s, then success


def test_exhausts_retries_on_persistent_503():
    client = make_client(lambda r: httpx.Response(503, text="down"))
    with pytest.raises(CtGovError):
        client.get("version")


def test_non_json_response_raises():
    client = make_client(lambda r: httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(CtGovError):
        client.get("version")
