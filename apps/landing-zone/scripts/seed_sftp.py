#!/usr/bin/env python3
"""Seed an SFTP destination with files from a demo variant or specific files.

Runs on the host as a developer helper. Two destination modes:

  * Local (default): copies into `apps/landing-zone/sample-data/sftp-staging/`,
    which is mounted into the atmoz/sftp container at /home/cro/upload.
  * Remote: uploads via SFTP to the URL passed in `--remote-url`.

Three input modes (mutually exclusive in the obvious ways):

  * `--variant NAME`   — drop the entire `sample-data/{variant}/` tree.
  * `--files PATH ...` — drop one or more specific local files (basename used
                          as the remote/local filename).
  * `--wipe` alone     — clear the destination without copying anything.

The destination is cleared first when `--variant` is given (existing behavior).
`--wipe` lets you do a wipe-only run, or wipe before `--files`.

For the `mess-late` variant the mtimes of the dropped files are backdated by
14 days. Works locally; on remote we attempt `SFTP utime` and warn if the
server rejects it.

Usage:

    # local, full variant
    python apps/landing-zone/scripts/seed_sftp.py --variant clean
    python apps/landing-zone/scripts/seed_sftp.py --variant mess-late

    # local, wipe only
    python apps/landing-zone/scripts/seed_sftp.py --wipe

    # remote, wipe + drop a single file
    python apps/landing-zone/scripts/seed_sftp.py \\
        --remote-url "sftp://user:pass@host/uploads" \\
        --wipe \\
        --files apps/landing-zone/sample-data/injection/DM.xpt

    # remote, re-upload single file (touch — refresh mtime)
    python apps/landing-zone/scripts/seed_sftp.py \\
        --remote-url "sftp://user:pass@host/uploads" \\
        --files apps/landing-zone/sample-data/injection/DM.xpt
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
import time
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urlparse

VARIANTS = (
    "clean",
    "injection",
    "mess-late",
    "mess-encoding",
    "mess-missing-domain",
    "mess-inconsistent-values",
)

# How far back to set mtimes for the `mess-late` variant. The study
# contract expects weekly SDTM deliveries, so 14 days places the files
# clearly past the deadline.
LATE_OFFSET_DAYS = 14


def repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--variant",
        choices=VARIANTS,
        help="Demo data variant to drop into the destination.",
    )
    parser.add_argument(
        "--files",
        nargs="+",
        type=Path,
        help="Specific local file paths to upload (basename used as remote name).",
    )
    parser.add_argument(
        "--wipe",
        action="store_true",
        help="Clear destination first; on its own, performs a wipe-only run.",
    )
    parser.add_argument(
        "--remote-url",
        help="Target a remote SFTP server (sftp://user:pass@host[:port]/path) instead of local.",
    )
    args = parser.parse_args()

    if not (args.variant or args.files or args.wipe):
        parser.error("at least one of --variant, --files, or --wipe is required")
    if args.variant and args.files:
        parser.error("--variant and --files are mutually exclusive")
    return args


# ---------------------------------------------------------------------------
# Sink abstraction
# ---------------------------------------------------------------------------


class Sink:
    """Destination-agnostic interface for seeding files."""

    def describe(self) -> str:
        raise NotImplementedError

    def list(self) -> list[str]:
        raise NotImplementedError

    def wipe(self) -> int:
        raise NotImplementedError

    def put(self, local_file: Path, name: str) -> None:
        raise NotImplementedError

    def set_mtime(self, name: str, timestamp: float) -> bool:
        """Best-effort backdating. Returns True on success."""
        raise NotImplementedError

    def close(self) -> None:
        pass


class LocalSink(Sink):
    def __init__(self, staging: Path) -> None:
        if not staging.is_dir():
            raise FileNotFoundError(f"staging directory not found at {staging}")
        self.staging = staging

    def describe(self) -> str:
        return str(self.staging)

    def list(self) -> list[str]:
        return [entry.name for entry in self.staging.iterdir() if entry.name != ".gitkeep"]

    def wipe(self) -> int:
        removed = 0
        for entry in self.staging.iterdir():
            if entry.name == ".gitkeep":
                continue
            if entry.is_dir():
                shutil.rmtree(entry)
            else:
                entry.unlink()
            removed += 1
        return removed

    def put(self, local_file: Path, name: str) -> None:
        destination = self.staging / name
        if local_file.is_dir():
            shutil.copytree(local_file, destination)
        else:
            shutil.copy2(local_file, destination)

    def set_mtime(self, name: str, timestamp: float) -> bool:
        target = self.staging / name
        if target.is_dir():
            for nested in target.rglob("*"):
                if nested.is_file():
                    os.utime(nested, (timestamp, timestamp))
        else:
            os.utime(target, (timestamp, timestamp))
        return True


class RemoteSftpSink(Sink):
    def __init__(self, url: str) -> None:
        try:
            import paramiko  # type: ignore
        except ImportError as exc:
            raise SystemExit(
                "seed_sftp: paramiko is required for --remote-url. Install with: pip install paramiko"
            ) from exc

        parsed = urlparse(url)
        if parsed.scheme != "sftp":
            raise ValueError(f"--remote-url must use sftp:// scheme, got {parsed.scheme!r}")
        if not parsed.hostname:
            raise ValueError("--remote-url is missing a hostname")

        username = unquote(parsed.username) if parsed.username else None
        password = unquote(parsed.password) if parsed.password else None
        host = parsed.hostname
        port = parsed.port or 22
        remote_path = parsed.path or "/"

        self._paramiko = paramiko
        self._transport = paramiko.Transport((host, port))
        self._transport.connect(username=username, password=password)
        self.client = paramiko.SFTPClient.from_transport(self._transport)
        if self.client is None:
            self._transport.close()
            raise RuntimeError("failed to open SFTP channel")

        self.remote_path = remote_path.rstrip("/") or "/"
        self._ensure_remote_dir(self.remote_path)
        self.client.chdir(self.remote_path)
        self._url_display = f"sftp://{username or ''}@{host}:{port}{self.remote_path}"

    def _ensure_remote_dir(self, path: str) -> None:
        # Walk path components, mkdir each missing one.
        if not path or path == "/":
            return
        parts = [p for p in path.split("/") if p]
        current = "" if path.startswith("/") else "."
        for part in parts:
            current = f"{current}/{part}" if current else part
            try:
                self.client.stat(current)
            except IOError:
                self.client.mkdir(current)

    def describe(self) -> str:
        return self._url_display

    def list(self) -> list[str]:
        return list(self.client.listdir(self.remote_path))

    def wipe(self) -> int:
        removed = 0
        for name in self.client.listdir(self.remote_path):
            target = f"{self.remote_path}/{name}"
            removed += self._remove_recursive(target)
        return removed

    def _remove_recursive(self, target: str) -> int:
        attrs = self.client.stat(target)
        from stat import S_ISDIR

        if S_ISDIR(attrs.st_mode):
            count = 0
            for nested in self.client.listdir(target):
                count += self._remove_recursive(f"{target}/{nested}")
            self.client.rmdir(target)
            return count + 1
        self.client.remove(target)
        return 1

    def put(self, local_file: Path, name: str) -> None:
        if local_file.is_dir():
            self._put_dir_recursive(local_file, f"{self.remote_path}/{name}")
        else:
            self.client.put(str(local_file), f"{self.remote_path}/{name}")

    def _put_dir_recursive(self, local_dir: Path, remote_dir: str) -> None:
        try:
            self.client.stat(remote_dir)
        except IOError:
            self.client.mkdir(remote_dir)
        for entry in sorted(local_dir.iterdir()):
            target = f"{remote_dir}/{entry.name}"
            if entry.is_dir():
                self._put_dir_recursive(entry, target)
            else:
                self.client.put(str(entry), target)

    def set_mtime(self, name: str, timestamp: float) -> bool:
        target = f"{self.remote_path}/{name}"
        try:
            attrs = self.client.stat(target)
            from stat import S_ISDIR

            if S_ISDIR(attrs.st_mode):
                self._set_mtime_recursive(target, timestamp)
            else:
                self.client.utime(target, (timestamp, timestamp))
            return True
        except (IOError, OSError):
            return False

    def _set_mtime_recursive(self, remote_dir: str, timestamp: float) -> None:
        from stat import S_ISDIR

        for name in self.client.listdir(remote_dir):
            target = f"{remote_dir}/{name}"
            attrs = self.client.stat(target)
            if S_ISDIR(attrs.st_mode):
                self._set_mtime_recursive(target, timestamp)
            else:
                self.client.utime(target, (timestamp, timestamp))

    def close(self) -> None:
        try:
            self.client.close()
        finally:
            self._transport.close()


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


def collect_variant_entries(source: Path) -> list[Path]:
    if not source.is_dir():
        raise FileNotFoundError(f"variant directory not found at {source}")
    return sorted(source.iterdir())


def collect_explicit_files(files: Iterable[Path]) -> list[Path]:
    resolved: list[Path] = []
    for raw in files:
        path = raw if raw.is_absolute() else (Path.cwd() / raw)
        if not path.is_file():
            raise FileNotFoundError(f"file not found: {raw}")
        resolved.append(path)
    return resolved


def main() -> int:
    args = parse_args()

    sample_data = repo_root() / "apps" / "landing-zone" / "sample-data"

    sink: Sink
    if args.remote_url:
        sink = RemoteSftpSink(args.remote_url)
    else:
        sink = LocalSink(sample_data / "sftp-staging")

    try:
        # Variant copy implicitly wipes (preserves prior behavior). Other modes
        # only wipe when --wipe is set.
        should_wipe = args.wipe or bool(args.variant)
        if should_wipe:
            removed = sink.wipe()
            print(f"seed_sftp: cleared {removed} entries from {sink.describe()}", file=sys.stderr)

        copied_names: list[str] = []

        if args.variant:
            source = sample_data / args.variant
            entries = collect_variant_entries(source)
            for entry in entries:
                sink.put(entry, entry.name)
                copied_names.append(entry.name)
            print(
                f"seed_sftp: copied {len(copied_names)} entries from {source} to {sink.describe()}",
                file=sys.stderr,
            )
        elif args.files:
            files = collect_explicit_files(args.files)
            for file_path in files:
                sink.put(file_path, file_path.name)
                copied_names.append(file_path.name)
            print(
                f"seed_sftp: uploaded {len(copied_names)} files to {sink.describe()}",
                file=sys.stderr,
            )

        if args.variant == "mess-late" and copied_names:
            timestamp = time.time() - (LATE_OFFSET_DAYS * 86400)
            failures: list[str] = []
            for name in copied_names:
                if not sink.set_mtime(name, timestamp):
                    failures.append(name)
            if failures:
                print(
                    f"seed_sftp: warning — could not backdate mtimes for: {', '.join(failures)}",
                    file=sys.stderr,
                )
            else:
                print(
                    f"seed_sftp: backdated mtimes by {LATE_OFFSET_DAYS} days for mess-late variant",
                    file=sys.stderr,
                )

        return 0
    finally:
        sink.close()


if __name__ == "__main__":
    sys.exit(main())
