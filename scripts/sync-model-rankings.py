#!/usr/bin/env python3
"""Scrape OpenRouter /rankings page for model popularity data and POST to Mediforce API.

Usage:
    python3 scripts/sync-model-rankings.py [--base-url URL]

Requires MEDIFORCE_API_KEY env var. Defaults to http://localhost:9003.
"""

import json
import os
import re
import sys
import urllib.request


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
    for model_id, name, count in matches:
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
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    base_url = "http://localhost:9003"
    for i, arg in enumerate(sys.argv[1:], 1):
        if arg == "--base-url" and i < len(sys.argv) - 1:
            base_url = sys.argv[i + 1]

    api_key = os.environ.get("MEDIFORCE_API_KEY") or os.environ.get("PLATFORM_API_KEY")
    if not api_key:
        print("ERROR: Set MEDIFORCE_API_KEY env var.", file=sys.stderr)
        sys.exit(1)

    print("Scraping OpenRouter /rankings...")
    rankings = scrape_rankings()
    print(f"Found {len(rankings)} models with request counts.")
    print(f"Top 5:")
    for r in rankings[:5]:
        print(f"  {r['requestCount']:>12,}  {r['id']}")

    print(f"\nPosting to {base_url}/api/model-registry/rankings...")
    result = post_rankings(rankings, base_url, api_key)
    print(f"Updated {result['updated']} models. Rankings updated at: {result['rankingsUpdatedAt']}")


if __name__ == "__main__":
    main()
