#!/usr/bin/env python3
"""Seed a namespace + owner member into the Firebase emulator.

Used for local dev when a user needs a team namespace (e.g. `appsilon`)
that is not in the E2E fixture pass. Personal namespaces bootstrap
automatically on first login via auth-context + the rules updated in
this PR; team namespaces still need an out-of-band seed write.

Usage:
    # Add a team namespace with an owner looked up by email.
    python3 packages/platform-ui/scripts/seed_namespace.py appsilon filip@appsilon.com

    # Add a personal namespace explicitly (normally auth-context does this).
    python3 packages/platform-ui/scripts/seed_namespace.py \
        filip filip@appsilon.com --type personal

Requirements:
    - Firebase emulator running (auth on 9099, firestore on 8080).
    - Target user already exists in the auth emulator (log in through
      the UI once so the user doc is created).

Talks directly to the emulator REST API — no firebase-admin install
needed. The `Authorization: Bearer owner` header bypasses security
rules, per the emulator's documented behavior.
"""

from __future__ import annotations

import argparse
import datetime
import json
import sys
import urllib.error
import urllib.request

AUTH_EMULATOR = "http://127.0.0.1:9099"
FIRESTORE_EMULATOR = "http://127.0.0.1:8080"
PROJECT_ID = "demo-mediforce"
ADMIN_HEADERS = {
    "Content-Type": "application/json",
    "Authorization": "Bearer owner",
}


def to_firestore_fields(data: dict[str, object]) -> dict[str, object]:
    """Convert a flat Python dict to Firestore REST {field: {typeValue}} form."""
    out: dict[str, object] = {}
    for key, value in data.items():
        if isinstance(value, bool):
            out[key] = {"booleanValue": value}
        elif isinstance(value, int):
            out[key] = {"integerValue": str(value)}
        elif isinstance(value, float):
            out[key] = {"doubleValue": value}
        elif isinstance(value, str):
            out[key] = {"stringValue": value}
        elif value is None:
            out[key] = {"nullValue": None}
        else:
            raise TypeError(f"Unsupported field type for {key}: {type(value).__name__}")
    return out


def http_request(method: str, url: str, body: dict | None = None) -> dict:
    payload = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=payload, method=method, headers=ADMIN_HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=5) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {url} → {e.code} {e.reason}\n{e.read().decode('utf-8')}") from e


def get_uid_by_email(email: str) -> str:
    url = f"{AUTH_EMULATOR}/emulator/v1/projects/{PROJECT_ID}/accounts"
    data = http_request("GET", url)
    accounts = data.get("userInfo", [])
    for account in accounts:
        if account.get("email") == email:
            return account["localId"]
    available = [a.get("email") for a in accounts if a.get("email")]
    raise RuntimeError(
        f"No auth user with email {email!r} in the emulator. "
        f"Known emails: {available}. Log in through the UI once to create the user."
    )


def doc_url(path: str) -> str:
    return f"{FIRESTORE_EMULATOR}/v1/projects/{PROJECT_ID}/databases/(default)/documents/{path}"


def patch_doc(path: str, data: dict[str, object]) -> None:
    body = {"fields": to_firestore_fields(data)}
    http_request("PATCH", doc_url(path), body)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a namespace + owner member into the Firestore emulator.")
    parser.add_argument("handle", help="Namespace handle (doc id under /namespaces).")
    parser.add_argument("owner_email", help="Email of the owner; must exist in the auth emulator.")
    parser.add_argument(
        "--type",
        choices=["team", "personal"],
        default="team",
        help="Namespace type. Personal is normally bootstrapped by auth-context; pass explicitly only for manual seeding.",
    )
    parser.add_argument(
        "--display-name",
        default=None,
        help="Display name for the namespace (defaults to handle).",
    )
    args = parser.parse_args()

    uid = get_uid_by_email(args.owner_email)
    now = datetime.datetime.now(datetime.UTC).isoformat().replace("+00:00", "Z")
    display_name = args.display_name or args.handle

    namespace_fields: dict[str, object] = {
        "handle": args.handle,
        "type": args.type,
        "displayName": display_name,
        "createdAt": now,
    }
    if args.type == "personal":
        namespace_fields["linkedUserId"] = uid

    patch_doc(f"namespaces/{args.handle}", namespace_fields)
    patch_doc(
        f"namespaces/{args.handle}/members/{uid}",
        {"uid": uid, "role": "owner", "joinedAt": now},
    )
    # Also pin the handle on the user doc so auth-context sees it as the
    # default namespace on next login.
    patch_doc(f"users/{uid}", {"handle": args.handle})

    print(f"✓ Seeded {args.type} namespace '{args.handle}' with owner {args.owner_email} ({uid})")


if __name__ == "__main__":
    try:
        main()
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
