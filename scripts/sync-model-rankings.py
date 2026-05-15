#!/usr/bin/env python3
"""Sync model registry from OpenRouter API, then scrape rankings for popularity data.

Usage:
    python3 scripts/sync-model-rankings.py [--base-url URL]

Requires MEDIFORCE_API_KEY env var. Defaults to http://localhost:9003.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

DEFAULT_BASE_URL = "http://localhost:9003"
MOCK_DEV_BASE_URL = "http://localhost:9007"


def sync_models(base_url: str, api_key: str) -> dict:
    """POST to /api/model-registry/sync to refresh all models from OpenRouter API."""
    url = f"{base_url}/api/model-registry/sync"
    req = urllib.request.Request(
        url,
        data=b"",
        headers={"X-Api-Key": api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8"))


def scrape_rankings() -> list[dict]:
    """Fetch OpenRouter /rankings HTML and extract request_count per model."""
    url = "https://openrouter.ai/rankings"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        html = resp.read().decode("utf-8")

    # Rankings data is embedded as inline JSON in RSC payload.
    # Pattern: "id":"provider/model","slug":"...","name":"...","author":"...","request_count":N
    pattern = r'"id":"([^"]+)","slug":"[^"]+","name":"([^"]+)","author":"[^"]+","request_count":(\d+)'
    unescaped = html.replace('\\"', '"').replace("\\n", "\n")
    matches = re.findall(pattern, unescaped)

    if not matches:
        print("ERROR: No ranking data found in HTML. Page structure may have changed.", file=sys.stderr)
        sys.exit(1)

    rankings = []
    for model_id, _name, count in matches:
        rankings.append({"id": model_id, "requestCount": int(count)})

    rankings.sort(key=lambda x: x["requestCount"], reverse=True)
    return rankings


def post_rankings(rankings: list[dict], base_url: str, api_key: str) -> dict:
    """POST rankings to Mediforce API."""
    url = f"{base_url}/api/model-registry/rankings"
    payload = json.dumps({"rankings": rankings}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Api-Key": api_key,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


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

    # Step 2: Scrape rankings from OpenRouter /rankings page
    print("\nStep 2: Scraping OpenRouter /rankings for popularity data...")
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
