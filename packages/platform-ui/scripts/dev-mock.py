#!/usr/bin/env python3
"""Run the zero-cloud local mock development server."""

from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path

PLATFORM_UI = Path(__file__).resolve().parent.parent
ROOT = PLATFORM_UI.parent.parent
FIREBASE_CONFIG = Path("/tmp/mediforce-dev-mock-firebase.json")

AUTH_PORT = 9099
NEXT_PORT = 9007

DEMO_ENV: dict[str, str] = {
    "NEXT_PUBLIC_USE_EMULATORS": "true",
    "NEXT_PUBLIC_FIREBASE_API_KEY": "fake-api-key-for-emulators",
    "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN": "demo-mediforce.firebaseapp.com",
    "NEXT_PUBLIC_FIREBASE_PROJECT_ID": "demo-mediforce",
    "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID": "000000000000",
    "NEXT_PUBLIC_FIREBASE_APP_ID": "1:000000000000:web:0000000000000000",
    "FIREBASE_AUTH_EMULATOR_HOST": f"127.0.0.1:{AUTH_PORT}",
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


def wait_for_ports(ports: list[int], timeout_seconds: int) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        if all(port_open(port) for port in ports):
            return True
        time.sleep(0.5)
    return False


def write_firebase_config() -> None:
    config = {
        "emulators": {
            "auth": {"port": AUTH_PORT},
            "ui": {"enabled": False},
        },
    }
    FIREBASE_CONFIG.write_text(json.dumps(config, indent=2))


def command_exists(command: str) -> bool:
    return shutil.which(command) is not None


def with_local_java(env: dict[str, str]) -> dict[str, str]:
    if env.get("JAVA_HOME") or command_exists("java"):
        return env

    for java_home in [
        Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"),
        Path("/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"),
    ]:
        java_bin = java_home / "bin"
        if java_bin.exists():
            return {
                **env,
                "JAVA_HOME": str(java_home),
                "PATH": f"{java_bin}{os.pathsep}{env.get('PATH', '')}",
            }

    return env


def start_emulators(env: dict[str, str]) -> subprocess.Popen[bytes] | None:
    emulator_ports = [AUTH_PORT]
    open_ports = [port for port in emulator_ports if port_open(port)]
    if len(open_ports) == len(emulator_ports):
        log("Firebase Auth emulator already running on 9099.")
        return None

    if open_ports:
        ports = ", ".join(str(port) for port in open_ports)
        missing = ", ".join(str(port) for port in emulator_ports if port not in open_ports)
        raise RuntimeError(
            f"Some emulator ports are already in use ({ports}), but others are missing ({missing}). "
            "Stop the stale emulator process and run pnpm dev:mock again."
        )

    if not command_exists("pnpm"):
        raise RuntimeError("pnpm is required to run dev:mock.")

    write_firebase_config()
    log("Starting local Firebase emulators...")
    proc = subprocess.Popen(
        [
            "pnpm",
            "exec",
            "firebase",
            "emulators:start",
            "--project",
            "demo-mediforce",
            "--only",
            "auth",
            "--config",
            str(FIREBASE_CONFIG),
        ],
        cwd=str(PLATFORM_UI),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    if not wait_for_ports(emulator_ports, 45):
        proc.terminate()
        raise RuntimeError(
            "Firebase emulators did not become ready within 45 seconds. "
            "Run `pnpm --filter @mediforce/platform-ui emulators` for full logs."
        )
    log("Firebase emulators are ready.")
    return proc


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
    env = with_local_java({**os.environ, **DEMO_ENV})
    emulator_proc: subprocess.Popen[bytes] | None = None
    try:
        if port_open(NEXT_PORT):
            raise RuntimeError(
                f"Port {NEXT_PORT} is already in use. Stop that process and run pnpm dev:mock again."
            )
        emulator_proc = start_emulators(env)
        seed_demo_data(env)
        return run_next(env)
    except subprocess.CalledProcessError as error:
        log(f"Command failed with exit code {error.returncode}: {' '.join(error.cmd)}")
        return error.returncode
    except RuntimeError as error:
        log(str(error))
        return 1
    finally:
        if emulator_proc is not None and emulator_proc.poll() is None:
            log("Stopping Firebase emulators...")
            emulator_proc.terminate()
            try:
                emulator_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                emulator_proc.kill()


if __name__ == "__main__":
    sys.exit(main())
