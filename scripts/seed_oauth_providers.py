#!/usr/bin/env python3
"""
Interactive setup helper for OAuth provider credentials.

Reads `data/seeds/oauth-providers.json`, checks each provider's required
env vars against the target `.env` file, and either:
  - reports what's set / missing (`--check`)
  - skips missing entries with a warning (`--non-interactive`, for CI)
  - guides through OAuth App registration and writes credentials to the
    env file (default, interactive)

The platform reads these env vars on boot via `seedBuiltinOAuthProviders`
in platform-api/src/services/seed-oauth-providers.ts and upserts the
resolved providers into Firestore at `namespaces/{ns}/oauthProviders/{id}`.

Usage:
    # Local dev — write to repo .env.local
    python3 scripts/seed_oauth_providers.py --env-file packages/platform-ui/.env.local

    # Production VPS — write to /opt/mediforce/.env
    python3 scripts/seed_oauth_providers.py --env-file /opt/mediforce/.env

    # CI — non-interactive: report only, never prompt
    python3 scripts/seed_oauth_providers.py --env-file .env --check
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
SEED_PATH = REPO_ROOT / "data" / "seeds" / "oauth-providers.json"

# Per-provider setup hints. Mirrors data/seeds/oauth-providers.json by id.
# Keep this small — adding new providers here is intentional, not automatic.
SETUP_HINTS: dict[str, dict[str, str]] = {
    "github": {
        "registration_url": "https://github.com/settings/applications/new",
        "callback_path": "/api/oauth/github/callback",
        "notes": (
            "Application name: choose something deployment-specific (e.g. "
            "'Mediforce Staging'). Homepage URL: your Mediforce public URL. "
            "After saving, generate a client secret."
        ),
    },
}


def _load_env(path: Path) -> dict[str, str]:
    """Parse a flat KEY=VALUE .env file. Lines starting with # or empty are
    skipped. No quote stripping (we want round-trip equality on writes)."""
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#"):
            continue
        if "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        env[key.strip()] = value.strip()
    return env


def _upsert_env(path: Path, updates: dict[str, str]) -> None:
    """Upsert KEY=VALUE pairs into the env file. Preserves comments and
    ordering for existing keys; appends new keys at the end."""
    if path.exists():
        lines = path.read_text(encoding="utf-8").splitlines(keepends=False)
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        lines = []

    seen: set[str] = set()
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped == "" or stripped.startswith("#") or "=" not in stripped:
            new_lines.append(line)
            continue
        key = stripped.split("=", 1)[0].strip()
        if key in updates:
            new_lines.append(f"{key}={updates[key]}")
            seen.add(key)
        else:
            new_lines.append(line)

    appended_keys = [key for key in updates if key not in seen]
    if appended_keys:
        if new_lines and new_lines[-1].strip() != "":
            new_lines.append("")
        new_lines.append("# Added by seed_oauth_providers.py")
        for key in appended_keys:
            new_lines.append(f"{key}={updates[key]}")

    path.write_text("\n".join(new_lines) + "\n", encoding="utf-8")


def _hint_for(provider_id: str) -> dict[str, str] | None:
    return SETUP_HINTS.get(provider_id)


def _print_setup_instructions(
    provider_id: str,
    provider_name: str,
    public_url: str | None,
) -> None:
    hint = _hint_for(provider_id)
    if hint is None:
        print(f"  No setup hint for provider '{provider_id}' — refer to vendor docs.")
        return

    callback = (
        f"{public_url.rstrip('/')}{hint['callback_path']}"
        if public_url
        else f"<your-mediforce-url>{hint['callback_path']}"
    )
    print(f"\n  Setup steps for {provider_name}:")
    print(f"    1. Open: {hint['registration_url']}")
    print(f"    2. Authorization callback URL: {callback}")
    print(f"    3. {hint['notes']}")


def _process_entry(
    namespace: str,
    entry: dict,
    env: dict[str, str],
    *,
    interactive: bool,
    public_url: str | None,
) -> tuple[dict[str, str], list[str]]:
    """Returns (updates_to_write, missing_after_processing)."""
    required: list[str] = [entry["clientIdEnv"]]
    if "clientSecretEnv" in entry:
        required.append(entry["clientSecretEnv"])

    missing = [name for name in required if env.get(name, "") == ""]
    if not missing:
        print(f"  ✓ {namespace}/{entry['id']}: all credentials set")
        return ({}, [])

    print(f"  ✗ {namespace}/{entry['id']}: missing {', '.join(missing)}")

    if not interactive:
        return ({}, missing)

    _print_setup_instructions(entry["id"], entry["name"], public_url)
    print()

    updates: dict[str, str] = {}
    for var_name in missing:
        is_secret = "SECRET" in var_name.upper() or "PASSWORD" in var_name.upper()
        prompt = f"  Paste {var_name}{' (input hidden)' if is_secret else ''}: "
        try:
            if is_secret:
                import getpass

                value = getpass.getpass(prompt)
            else:
                value = input(prompt)
        except (EOFError, KeyboardInterrupt):
            print("\n  Skipped.")
            return ({}, missing)
        value = value.strip()
        if value == "":
            print(f"  Skipped {var_name} — left empty.")
            return ({}, missing)
        updates[var_name] = value

    return (updates, [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--env-file",
        type=Path,
        default=REPO_ROOT / "packages" / "platform-ui" / ".env.local",
        help="Path to the env file to read/write (default: %(default)s).",
    )
    parser.add_argument(
        "--public-url",
        default=None,
        help=(
            "Public URL of this deployment, used to build callback URLs in "
            "the setup instructions (e.g. https://staging.mediforce.app). "
            "Defaults to MEDIFORCE_PUBLIC_URL or APP_BASE_URL from the env file."
        ),
    )
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Never prompt; report missing vars and exit 0. Suitable for CI.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Read-only: report what's set / missing without changes.",
    )
    args = parser.parse_args()

    if not SEED_PATH.exists():
        print(f"Seed file not found at {SEED_PATH}", file=sys.stderr)
        return 1

    seed_data = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    env = _load_env(args.env_file)
    public_url = (
        args.public_url
        or env.get("MEDIFORCE_PUBLIC_URL")
        or env.get("APP_BASE_URL")
        or env.get("NEXT_PUBLIC_APP_URL")
    )

    interactive = not args.non_interactive and not args.check

    print(f"Reading {SEED_PATH.relative_to(REPO_ROOT)}")
    print(f"Env file: {args.env_file}")
    if public_url:
        print(f"Public URL: {public_url}")

    all_updates: dict[str, str] = {}
    total_missing: list[str] = []

    for namespace, entries in seed_data.items():
        print(f"\nNamespace: {namespace}")
        for entry in entries:
            updates, missing = _process_entry(
                namespace,
                entry,
                env,
                interactive=interactive,
                public_url=public_url,
            )
            all_updates.update(updates)
            total_missing.extend(missing)
            # Reflect freshly captured values for subsequent entries in the
            # same run (e.g. when two entries reference the same env var).
            env.update(updates)

    if args.check:
        print()
        if total_missing:
            print(f"Missing env vars: {', '.join(sorted(set(total_missing)))}")
            return 1
        print("All providers have their credentials configured.")
        return 0

    if all_updates:
        _upsert_env(args.env_file, all_updates)
        print(f"\nWrote {len(all_updates)} variable(s) to {args.env_file}")
        print(
            "Restart the platform (e.g. `docker compose restart platform-ui`) so "
            "the boot-time seeder picks up the new credentials.",
        )
    else:
        print("\nNo changes made.")

    return 0


if __name__ == "__main__":
    sys.exit(main())
