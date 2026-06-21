"""Offline tests for CdiscLibraryClient using httpx.MockTransport (no network)."""

import httpx
import pytest

from cdisclib_mcp.client import (
    CdiscAuthError,
    CdiscLibraryClient,
    CdiscLibraryError,
    CdiscNotFound,
)


def make_client(handler, api_key="testkey"):
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport, base_url="https://x")
    # sleep is a no-op so retry tests don't actually wait.
    return CdiscLibraryClient(
        api_key=api_key, base_url="https://x", client=http, sleep=lambda _s: None
    )


def test_get_returns_json_and_drops_none_params():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["api_key"] = request.headers.get("api-key")
        return httpx.Response(200, json={"ok": True})

    client = make_client(handler)
    result = client.get("mdr/search", {"q": "glucose", "type": None, "pageSize": 2})
    assert result == {"ok": True}
    # None-valued param is dropped; provided params are kept; api-key header is sent.
    assert "type" not in seen["url"]
    assert "q=glucose" in seen["url"]
    assert "pageSize=2" in seen["url"]
    assert seen["api_key"] == "testkey"


def test_missing_api_key_raises_auth_error_before_network(monkeypatch):
    # Ensure no key leaks in from the real environment.
    monkeypatch.delenv("CDISC_API_KEY", raising=False)

    # No handler should ever be hit.
    def handler(request):  # pragma: no cover - must not be called
        raise AssertionError("network must not be touched without a key")

    client = make_client(handler, api_key=None)
    with pytest.raises(CdiscAuthError):
        client.get("mdr/products")


def test_401_raises_auth_error():
    client = make_client(lambda r: httpx.Response(401, text="unauthorized"))
    with pytest.raises(CdiscAuthError):
        client.get("mdr/products")


def test_403_raises_auth_error():
    client = make_client(lambda r: httpx.Response(403, text="members only"))
    with pytest.raises(CdiscAuthError):
        client.get("cosmos/v2/mdr/bc/biomedicalconcepts")


def test_404_raises_not_found():
    client = make_client(lambda r: httpx.Response(404, text="not found"))
    with pytest.raises(CdiscNotFound):
        client.get("cosmos/v2/mdr/bc/biomedicalconcepts/NOTREAL")


def test_http_400_raises_library_error():
    client = make_client(lambda r: httpx.Response(400, text="bad request"))
    with pytest.raises(CdiscLibraryError) as exc:
        client.get("mdr/search")
    assert "400" in str(exc.value)


def test_retries_on_429_then_succeeds():
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"Retry-After": "0"}, text="slow down")
        return httpx.Response(200, json={"ok": True})

    client = make_client(handler)
    assert client.get("mdr/products") == {"ok": True}
    assert calls["n"] == 3  # two 429s, then success


def test_exhausts_retries_on_persistent_503():
    client = make_client(lambda r: httpx.Response(503, text="down"))
    with pytest.raises(CdiscLibraryError):
        client.get("mdr/products")


def test_non_json_response_raises():
    client = make_client(lambda r: httpx.Response(200, text="<html>not json</html>"))
    with pytest.raises(CdiscLibraryError):
        client.get("mdr/products")
