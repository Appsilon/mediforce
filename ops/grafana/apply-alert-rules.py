#!/usr/bin/env python3
# /// script
# requires-python = ">=3.9"
# dependencies = ["pyyaml"]
# ///
"""Push ops/grafana/alert-rules.yaml to a Grafana Cloud stack.

Grafana Cloud can't load provisioning files, so this sends the same file
through the alerting provisioning API: it creates the folder if missing, then
replaces each rule group. Rules in a group that the file no longer lists are
deleted. Re-running it is safe.

Applied rules are read-only in the Grafana UI. Change them in the YAML file and
run this again (docs/guides/monitoring.md).

Usage, from a laptop, never from the server:
    GRAFANA_URL=https://<stack>.grafana.net \\
    GRAFANA_TOKEN=<service account token, Editor role> \\
    uv run ops/grafana/apply-alert-rules.py

Without uv: `pip install pyyaml`, then `python3 ops/grafana/apply-alert-rules.py`.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

import yaml

RULES_FILE = Path(__file__).with_name("alert-rules.yaml")
DURATION = re.compile(r"^(\d+)([smh])$")
SECONDS_PER_UNIT = {"s": 1, "m": 60, "h": 3600}


def folder_uid(title: str) -> str:
    return re.sub(r"[^a-z0-9-]", "-", title.lower())


def interval_seconds(interval: str) -> int:
    match = DURATION.match(interval)
    if match is None:
        raise ValueError(f"unsupported interval {interval!r}, use e.g. 1m")
    return int(match.group(1)) * SECONDS_PER_UNIT[match.group(2)]


class Grafana:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, method: str, path: str, body: dict | None = None) -> tuple[int, str]:
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, response.read().decode()
        except urllib.error.HTTPError as error:
            return error.code, error.read().decode()

    def ensure_folder(self, uid: str, title: str) -> None:
        status, _ = self.request("GET", f"/api/folders/{uid}")
        if status == 200:
            return
        status, text = self.request("POST", "/api/folders", {"uid": uid, "title": title})
        if status != 200:
            raise RuntimeError(f"creating folder {title!r} failed ({status}): {text}")
        print(f"[grafana] created folder {title}")

    def put_group(self, group: dict, uid: str) -> None:
        rules = [{**rule, "folderUID": uid, "ruleGroup": group["name"], "orgID": group["orgId"]} for rule in group["rules"]]
        body = {"title": group["name"], "folderUid": uid, "interval": interval_seconds(group["interval"]), "rules": rules}
        status, text = self.request("PUT", f"/api/v1/provisioning/folder/{uid}/rule-groups/{group['name']}", body)
        if status != 200:
            raise RuntimeError(f"rule group {group['name']!r} failed ({status}): {text}")
        print(f"[grafana] {group['name']}: {len(rules)} rules")


def main() -> None:
    parser = argparse.ArgumentParser(description="Apply Mediforce alert rules to Grafana Cloud")
    parser.add_argument("--file", type=Path, default=RULES_FILE)
    args = parser.parse_args()

    base_url = os.environ.get("GRAFANA_URL", "")
    token = os.environ.get("GRAFANA_TOKEN", "")
    if base_url == "" or token == "":
        sys.exit("Set GRAFANA_URL and GRAFANA_TOKEN")

    grafana = Grafana(base_url, token)
    document = yaml.safe_load(args.file.read_text())
    try:
        for group in document["groups"]:
            uid = folder_uid(group["folder"])
            grafana.ensure_folder(uid, group["folder"])
            grafana.put_group(group, uid)
    except (RuntimeError, ValueError, urllib.error.URLError) as error:
        sys.exit(f"[grafana] ERROR: {error}")


if __name__ == "__main__":
    main()
