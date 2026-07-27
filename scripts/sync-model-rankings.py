#!/usr/bin/env python3
"""Sync model registry from OpenRouter API, then fetch rankings for popularity data.

Usage:
    python3 scripts/sync-model-rankings.py [--base-url URL]

Requires MEDIFORCE_API_KEY env var. Defaults to http://localhost:9003.
"""

import json
import os
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://localhost:9003"
MOCK_DEV_BASE_URL = "http://localhost:9007"
OPENROUTER_RANKINGS_URL = "https://openrouter.ai/api/frontend/v1/rankings/performance"


def sync_models(base_url: str, api_key: str) -> dict:
    """POST to /api/model-registry/sync to refresh all models from OpenRouter API."""
    body = _fetch(
        f"{base_url}/api/model-registry/sync",
        headers={"X-Api-Key": api_key},
        data=b"",
        timeout=120,
    )
    return json.loads(body.decode("utf-8"))


BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"


def _fetch(url: str, headers: dict | None = None, data: bytes | None = None,
           timeout: int = 30) -> bytes:
    hdrs = {"User-Agent": BROWSER_UA}
    if headers:
        hdrs.update(headers)
    method = "POST" if data is not None else "GET"
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def scrape_rankings() -> list[dict]:
    """Fetch OpenRouter performance rankings and extract request_count per model."""
    body = _fetch(
        OPENROUTER_RANKINGS_URL,
        headers={"Accept": "application/json", "Referer": "https://openrouter.ai/rankings"},
    )
    payload = json.loads(body.decode("utf-8"))
    rows = payload.get("data")
    if not isinstance(rows, list):
        print("ERROR: Unexpected rankings response from OpenRouter.", file=sys.stderr)
        sys.exit(1)

    rankings = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        model_id = row.get("id")
        count = row.get("request_count")
        if isinstance(model_id, str) and isinstance(count, int):
            rankings.append({"id": model_id, "requestCount": count})

    if len(rankings) == 0:
        print("ERROR: No ranking data in OpenRouter response.", file=sys.stderr)
        sys.exit(1)

    rankings.sort(key=lambda x: x["requestCount"], reverse=True)
    return rankings


def post_rankings(rankings: list[dict], base_url: str, api_key: str) -> dict:
    """POST rankings to Mediforce API."""
    payload = json.dumps({"rankings": rankings}).encode("utf-8")
    body = _fetch(
        f"{base_url}/api/model-registry/rankings",
        headers={"Content-Type": "application/json", "X-Api-Key": api_key},
        data=payload,
        timeout=60,
    )
    return json.loads(body.decode("utf-8"))


def main():
    base_url = (
        os.environ.get("MEDIFORCE_BASE_URL")
        or os.environ.get("PLATFORM_BASE_URL")
        or os.environ.get("NEXT_PUBLIC_APP_URL")
        or DEFAULT_BASE_URL
    )
    explicit_base_url = False
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--base-url" and i < len(sys.argv) - 1:
            base_url = sys.argv[i + 1]
            explicit_base_url = True

    api_key = os.environ.get("MEDIFORCE_API_KEY") or os.environ.get("PLATFORM_API_KEY")
    if not api_key:
        print("ERROR: Set MEDIFORCE_API_KEY env var.", file=sys.stderr)
        sys.exit(1)

    # Step 1: Sync model metadata from OpenRouter API
    print(f"Step 1: Syncing models from OpenRouter API via {base_url}...")
    try:
        sync_result = sync_models(base_url, api_key)
    except urllib.error.URLError:
        if explicit_base_url or base_url != DEFAULT_BASE_URL:
            raise
        base_url = MOCK_DEV_BASE_URL
        print(f"  Could not reach {DEFAULT_BASE_URL}; retrying mock dev server at {base_url}...")
        sync_result = sync_models(base_url, api_key)
    print(f"  Synced {sync_result['synced']} models ({sync_result['total']} from OpenRouter).")

    # Step 2: Fetch rankings from OpenRouter
    print("\nStep 2: Fetching OpenRouter rankings for popularity data...")
    rankings = scrape_rankings()
    print(f"  Found {len(rankings)} models with request counts.")
    print(f"  Top 5:")
    for r in rankings[:5]:
        print(f"    {r['requestCount']:>12,}  {r['id']}")

    # Step 3: POST rankings to Mediforce
    print(f"\nStep 3: Posting rankings to {base_url}...")
    result = post_rankings(rankings, base_url, api_key)
    print(f"  Updated {result['updated']} of {len(rankings)} models.")
    print(f"  Rankings updated at: {result['rankingsUpdatedAt']}")

    skipped = len(rankings) - result["updated"]
    if skipped > 0:
        print(f"  ({skipped} models from rankings not found in registry — variant slugs or new models)")


if __name__ == "__main__":
    main()
