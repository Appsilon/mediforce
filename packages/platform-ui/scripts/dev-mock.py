#!/usr/bin/env python3
"""Run the zero-cloud local mock development server."""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
from pathlib import Path

PLATFORM_UI = Path(__file__).resolve().parent.parent
REPO_ROOT = PLATFORM_UI.parent.parent

NEXT_PORT = 9007
DEV_DATABASE_URL = "postgresql://mediforce:mediforce@localhost:5432/mediforce"

# Identity is NextAuth over Postgres (ADR-0002). The seeded demo user signs in
# with a password, so password auth is on and a fixed throwaway signing secret
# is supplied — never a real deployment secret.
#
# What "mock" means here: mocked agents, no cloud keys, no OpenRouter, no email.
# It does NOT mean "no database" — every repository has been Postgres-only since
# ADR-0001, so this starts the same dev Postgres container `pnpm dev` uses.
DEMO_ENV: dict[str, str] = {
    "ENABLE_PASSWORD_AUTH": "true",
    "AUTH_SECRET": "dev-mock-auth-secret-not-for-production-00000000000000000000",
    "MOCK_AGENT": "true",
    "MEDIFORCE_DATA_DIR": "/tmp/mediforce-e2e-data",
    "NEXT_PUBLIC_APP_URL": f"http://localhost:{NEXT_PORT}",
    "NO_PROXY": "localhost,127.0.0.1",
    "no_proxy": "localhost,127.0.0.1",
    "OPENROUTER_API_KEY": "fake-openrouter-key",
    "PLATFORM_API_KEY": "test-api-key",
    "SECRETS_ENCRYPTION_KEY": "0" * 64,
    "MEDIFORCE_DISABLE_EMAIL": "true",
}


def log(message: str) -> None:
    print(f"[dev:mock] {message}", flush=True)


def port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return True
    except OSError:
        return False


def start_database(env: dict[str, str]) -> None:
    log("Starting dev Postgres and applying migrations...")
    subprocess.run(
        ["python3", "scripts/dev-infra.py"],
        cwd=str(REPO_ROOT),
        env=env,
        check=True,
    )
    subprocess.run(
        ["pnpm", "db:migrate"],
        cwd=str(REPO_ROOT),
        env=env,
        check=True,
    )


def seed_demo_data(env: dict[str, str]) -> None:
    if os.environ.get("MEDIFORCE_DEV_MOCK_SEED") == "false":
        log("Skipping demo seed because MEDIFORCE_DEV_MOCK_SEED=false.")
        return

    log("Seeding demo user and workspace data...")
    subprocess.run(
        ["pnpm", "exec", "tsx", "scripts/seed-dev-data.ts"],
        cwd=str(PLATFORM_UI),
        env=env,
        check=True,
    )


def run_next(env: dict[str, str]) -> int:
    log(f"Starting Next.js on http://localhost:{NEXT_PORT}")
    proc = subprocess.Popen(
        ["pnpm", "exec", "next", "dev", "-p", str(NEXT_PORT)],
        cwd=str(PLATFORM_UI),
        env=env,
    )
    try:
        return proc.wait()
    except KeyboardInterrupt:
        proc.send_signal(signal.SIGINT)
        return proc.wait()


def main() -> int:
    # An ambient DATABASE_URL wins so a developer can point mock mode at their
    # own database; otherwise the shared dev container is used.
    env = {**os.environ, **DEMO_ENV}
    env.setdefault("DATABASE_URL", DEV_DATABASE_URL)
    try:
        if port_open(NEXT_PORT):
            raise RuntimeError(
                f"Port {NEXT_PORT} is already in use. Stop that process and run pnpm dev:mock again."
            )
        start_database(env)
        seed_demo_data(env)
        return run_next(env)
    except subprocess.CalledProcessError as error:
        log(f"Command failed with exit code {error.returncode}: {' '.join(error.cmd)}")
        return error.returncode
    except RuntimeError as error:
        log(str(error))
        return 1


if __name__ == "__main__":
    sys.exit(main())
