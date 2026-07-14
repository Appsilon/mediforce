"""HTTP client for the ClinicalTrials.gov API v2.

All endpoints are GET, unauthenticated, and return JSON by default. The client adds a
descriptive User-Agent, a timeout, and exponential backoff on 429/5xx so the MCP tools
stay thin wrappers that return the API payload verbatim.
"""

from __future__ import annotations

import os
import time
from typing import Any, Mapping

import httpx

DEFAULT_BASE_URL = "https://clinicaltrials.gov/api/v2"
DEFAULT_TIMEOUT = 30.0
DEFAULT_USER_AGENT = "ctgov-mcp/0.1.0 (+protocol-to-synthetic-sdtm)"

# Retried status codes and backoff schedule.
_RETRY_STATUSES = {429, 500, 502, 503, 504}
_MAX_RETRIES = 4
_BACKOFF_BASE = 0.5  # seconds; doubled each attempt: 0.5, 1, 2, 4


class CtGovError(RuntimeError):
    """Raised when a request to ClinicalTrials.gov fails in a way the caller should see."""


class CtGovNotFound(CtGovError):
    """Raised on a 404 (e.g. an unknown NCT id)."""


class CtGovClient:
    """Thin synchronous client over the ClinicalTrials.gov API v2.

    Parameters
    ----------
    base_url:
        Override the API base. Defaults to env ``CTGOV_BASE_URL`` then the public v2 URL.
    timeout:
        Per-request timeout in seconds.
    sleep:
        Injectable sleep function (tests pass a no-op to avoid real backoff waits).
    """

    def __init__(
        self,
        base_url: str | None = None,
        timeout: float = DEFAULT_TIMEOUT,
        client: httpx.Client | None = None,
        sleep=time.sleep,
    ) -> None:
        self.base_url = (base_url or os.environ.get("CTGOV_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self._owns_client = client is None
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={"User-Agent": DEFAULT_USER_AGENT, "Accept": "application/json"},
            follow_redirects=True,
        )
        self._sleep = sleep

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "CtGovClient":
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()

    def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        """GET ``{base_url}/{path}`` and return parsed JSON.

        Drops params whose value is ``None``. Retries 429/5xx with exponential backoff,
        honoring a ``Retry-After`` header when present. Raises ``CtGovNotFound`` on 404 and
        ``CtGovError`` on other non-2xx responses or network failures.
        """
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
                raise CtGovError(f"Network error calling {url}: {exc}") from exc

            if resp.status_code == 404:
                raise CtGovNotFound(f"Not found (404): {resp.url}")

            if resp.status_code in _RETRY_STATUSES and attempt < _MAX_RETRIES:
                self._sleep(self._retry_delay(resp, attempt))
                continue

            if resp.status_code >= 400:
                raise CtGovError(
                    f"ClinicalTrials.gov returned HTTP {resp.status_code} for {resp.url}: "
                    f"{resp.text[:300]}"
                )

            try:
                return resp.json()
            except ValueError as exc:
                raise CtGovError(f"Non-JSON response from {resp.url}: {resp.text[:200]}") from exc

        # Exhausted retries on a retryable status.
        raise CtGovError(f"Exhausted retries calling {url}: last error {last_exc}")

    @staticmethod
    def _retry_delay(resp: httpx.Response, attempt: int) -> float:
        retry_after = resp.headers.get("Retry-After")
        if retry_after:
            try:
                return float(retry_after)
            except ValueError:
                pass
        return _BACKOFF_BASE * (2**attempt)
