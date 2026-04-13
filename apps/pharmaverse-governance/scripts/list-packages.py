"""List pharmaverse packages from the official pharmaverse/pharmaverse registry."""

import base64
import json
import os
import urllib.request

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN")
REPO = "pharmaverse/pharmaverse"
BRANCH = "develop"
PACKAGES_PATH = "data/packages"


def github_get(url: str) -> list | dict:
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "mediforce-pharmaverse-governance",
        "Authorization": f"Bearer {GITHUB_TOKEN}",
    }
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())


def parse_yaml_simple(text: str) -> dict[str, str]:
    """Parse flat key: value YAML without external dependencies."""
    fields: dict[str, str] = {}
    current_key: str | None = None
    current_value = ""

    for line in text.splitlines():
        if current_key is not None and line.startswith((" ", "\t")):
            current_value += " " + line.strip()
            continue

        if current_key is not None:
            fields[current_key] = current_value.strip()

        if ":" in line and not line.startswith((" ", "\t", "#")):
            key, _, value = line.partition(":")
            current_key = key.strip()
            current_value = value.strip()
        else:
            current_key = None

    if current_key is not None:
        fields[current_key] = current_value.strip()

    return fields


def main() -> None:
    url = f"https://api.github.com/repos/{REPO}/contents/{PACKAGES_PATH}?ref={BRANCH}"
    entries = github_get(url)

    packages = []
    for entry in entries:
        if not entry["name"].endswith(".yaml"):
            continue

        file_data = github_get(entry["url"])
        text = base64.b64decode(file_data["content"]).decode("utf-8")

        fields = parse_yaml_simple(text)
        name = fields.get("name", entry["name"].removesuffix(".yaml"))
        docs = fields.get("docs", "")
        packages.append({"name": name, "docs": docs})

    packages.sort(key=lambda p: p["name"].lower())

    print(f"Found {len(packages)} packages in pharmaverse registry:\n")
    for pkg in packages:
        docs_suffix = f"  ({pkg['docs']})" if pkg["docs"] else ""
        print(f"  {pkg['name']}{docs_suffix}")


if __name__ == "__main__":
    main()
