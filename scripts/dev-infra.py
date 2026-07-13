#!/usr/bin/env python3
"""Bring up the local dev infrastructure (Postgres, optionally Redis) and fail
loudly with an actionable message when a prerequisite is missing.

`pnpm dev` / `pnpm dev:queue` call this before `pnpm db:migrate` and `next dev`.
The old inline `docker compose up postgres -d` stopped the `&&` chain on a raw
`docker: unknown command: docker compose` line that was easy to miss — the app
then booted against a non-existent database and only surfaced
`ECONNREFUSED 127.0.0.1:5432` deep in a request handler. This script checks each
prerequisite up front and explains exactly what to install.

Readiness is delegated to Compose's `--wait` flag, which blocks on the
`pg_isready` healthcheck already defined for the postgres service in
docker-compose.yml — so when this script exits 0, Postgres is accepting
connections, not merely "container started".

Usage:
    python3 scripts/dev-infra.py            # postgres only (pnpm dev)
    python3 scripts/dev-infra.py --redis    # postgres + redis (pnpm dev:queue)
"""

import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
COMPOSE_FILES = ["-f", "docker-compose.yml", "-f", "docker-compose.dev.yml"]
WAIT_TIMEOUT_SECONDS = 60


def fail(message: str) -> None:
    print(f"\n\033[31m✗ pnpm dev: {message}\033[0m\n", file=sys.stderr)
    sys.exit(1)


def check_docker_installed() -> None:
    if shutil.which("docker") is None:
        fail(
            "Docker is not installed.\n"
            "  • macOS / Windows: install Docker Desktop — https://docs.docker.com/desktop/\n"
            "  • Ubuntu / Debian:  sudo apt install docker.io docker-compose-v2\n"
            "Or use `pnpm dev:mock` for a no-Docker, in-memory stack."
        )


def check_docker_running() -> None:
    result = subprocess.run(
        ["docker", "info"], capture_output=True, text=True
    )
    if result.returncode != 0:
        fail(
            "Docker is installed but the daemon is not reachable.\n"
            "  • Docker Desktop: start the app and wait for it to report 'running'.\n"
            "  • Linux engine:   sudo systemctl start docker\n"
            f"docker info said: {result.stderr.strip().splitlines()[-1] if result.stderr.strip() else 'unknown error'}"
        )


def check_compose_installed() -> None:
    result = subprocess.run(
        ["docker", "compose", "version"], capture_output=True, text=True
    )
    if result.returncode != 0:
        fail(
            "Docker Compose v2 is not installed — the `docker compose` subcommand is missing.\n"
            "  • macOS / Windows: Docker Desktop bundles it; make sure Desktop is up to date.\n"
            "  • Ubuntu / Debian (engine-only `docker.io`): sudo apt install docker-compose-v2\n"
            "  • Other Linux: https://docs.docker.com/compose/install/linux/"
        )


def bring_up(services: list[str]) -> None:
    cmd = (
        ["docker", "compose"]
        + COMPOSE_FILES
        + ["up", *services, "-d", "--wait", "--wait-timeout", str(WAIT_TIMEOUT_SECONDS)]
    )
    print(f"→ {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=REPO_ROOT)
    if result.returncode != 0:
        fail(
            f"Postgres did not become healthy within {WAIT_TIMEOUT_SECONDS}s "
            f"(services: {', '.join(services)}).\n"
            "Inspect it with:\n"
            "  docker compose -f docker-compose.yml -f docker-compose.dev.yml logs postgres\n"
            "If the data volume is corrupt, reset it:\n"
            "  docker compose -f docker-compose.yml -f docker-compose.dev.yml down -v && pnpm dev"
        )


def main() -> None:
    services = ["postgres"]
    if "--redis" in sys.argv[1:]:
        services.append("redis")

    check_docker_installed()
    check_docker_running()
    check_compose_installed()
    bring_up(services)
    print(f"\033[32m✓ Dev infra ready: {', '.join(services)} on localhost\033[0m")


if __name__ == "__main__":
    main()
