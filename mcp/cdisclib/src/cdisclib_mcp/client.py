"""HTTP client for the CDISC Library API.

All endpoints are GET and authenticated with an ``api-key`` header (the cdiscID from
``CDISC_API_KEY``). Responses are JSON (HAL/hypermedia for index resources). The client adds
a descriptive User-Agent, a timeout, and exponential backoff on 429/5xx so the MCP tools stay
thin wrappers that return the API payload verbatim — Stage 3/4 must persist these records
(BCs, Dataset Specializations, codelists) and pin their package versions for provenance.

The Library has two co-resident namespaces under ``/api``:
  * ``mdr/...``          — core MDR (Controlled Terminology, search, product index)
  * ``cosmos/v2/mdr/...`` — COSMoS (Biomedical Concepts, SDTM Dataset Specializations)
Tool paths therefore include their namespace prefix; this client just prepends the base URL.
"""

from __future__ import annotations

import os
import time
from typing import Any, Mapping

import httpx

DEFAULT_BASE_URL = "https://library.cdisc.org/api"
DEFAULT_TIMEOUT = 30.0
DEFAULT_USER_AGENT = "cdisclib-mcp/0.1.0 (+protocol-to-synthetic-sdtm)"
API_KEY_ENV = "CDISC_API_KEY"

# Retried status codes and backoff schedule.
_RETRY_STATUSES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 4
_BACKOFF_BASE = 0.5  # seconds; doubled each attempt: 0.5, 1, 2, 4


class CdiscLibraryError(RuntimeError):
    """Raised when a request to the CDISC Library fails in a way the caller should see."""


class CdiscNotFound(CdiscLibraryError):
    """Raised on a 404 (e.g. an unknown conceptId, specialization id, or codelist)."""


class CdiscAuthError(CdiscLibraryError):
    """Raised on a 401/403 — usually a missing/invalid/insufficiently-privileged CDISC_API_KEY."""


class CdiscLibraryClient:
    """Thin synchronous client over the CDISC Library API.

    Parameters
    ----------
    api_key:
        The cdiscID. Defaults to env ``CDISC_API_KEY``. Required — a request without it
        raises ``CdiscAuthError`` before any network call.
    base_url:
        Override the API base. Defaults to env ``CDISC_LIBRARY_BASE_URL`` then the public URL.
    timeout:
        Per-request timeout in seconds.
    sleep:
        Injectable sleep function (tests pass a no-op to avoid real backoff waits).
    """

    def __init__(
        self,
        api_key: str | None = None,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
        sleep=time.sleep,
    ) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get(API_KEY_ENV)
        self.base_url = (
            base_url or os.environ.get("CDISC_LIBRARY_BASE_URL") or DEFAULT_BASE_URL
        ).rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        )
        # Apply auth to whichever client is used (owned or injected) so the api-key
        # header rides every request.
        if self.api_key:
            self._client.headers["api-key"] = self.api_key
        self._sleep = sleep

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "CdiscLibraryClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        """GET ``{base_url}/{path}`` and return parsed JSON.

        Drops params whose value is ``None``. Retries 429/5xx with exponential backoff,
        honoring a ``Retry-After`` header when present. Raises ``CdiscAuthError`` on
        401/403, ``CdiscNotFound`` on 404, and ``CdiscLibraryError`` on other non-2xx
        responses or network failures.
        """
        if not self.api_key:
            raise CdiscAuthError(
                f"No CDISC API key. Set the {API_KEY_ENV} environment variable "
                "(your cdiscID from library.cdisc.org)."
            )

        url = f"{self.base_url}/{path.lstrip('/')}"
        clean = {k: v for k, v in (params or {}).items() if v is not None}

        last_exc: Exception | None = None
        for attempt in range(_MAX_RETRIES + 1):
            try:
                resp = self._client.get(url, params=clean)
            except httpx.HTTPError as exc:  # network/timeout
                last_exc = exc
                if attempt < _MAX_RETRIES:
                    self._sleep(_BACKOFF_BASE * (2**attempt))
                    continue
                raise CdiscLibraryError(f"Network error calling {url}: {exc}") from exc

            if resp.status_code in (401, 403):
                raise CdiscAuthError(
                    f"CDISC Library returned HTTP {resp.status_code} for {resp.url}: "
                    f"check that {API_KEY_ENV} is valid and has access. {resp.text[:200]}"
                )

            if resp.status_code == 404:
                raise CdiscNotFound(f"Not found (404): {resp.url}")

            if resp.status_code in _RETRY_STATUSES and attempt < _MAX_RETRIES:
                self._sleep(self._retry_delay(resp, attempt))
                continue

            if resp.status_code >= 400:
                raise CdiscLibraryError(
                    f"CDISC Library returned HTTP {resp.status_code} for {resp.url}: "
                    f"{resp.text[:300]}"
                )

            try:
                return resp.json()
            except ValueError as exc:
                raise CdiscLibraryError(
                    f"Non-JSON response from {resp.url}: {resp.text[:200]}"
                ) from exc

        # Exhausted retries on a retryable status.
        raise CdiscLibraryError(f"Exhausted retries calling {url}: last error {last_exc}")

    @staticmethod
    def _retry_delay(resp: httpx.Response, attempt: int) -> float:
        retry_after = resp.headers.get("Retry-After")
        if retry_after:
            try:
                return float(retry_after)
            except ValueError:
                pass
        return _BACKOFF_BASE * (2**attempt)
