"""SFTP poll step for the landing-zone workflow.

Connects to the CRO SFTP server, lists the remote upload path, diffs against
the previous run's listing (carried over via PR #217 mechanism), and downloads
any new files into /workspace/incoming/{deliveryId}/ for downstream steps.

Inputs:
  /output/previous_run.json  — previousRun snapshot (may be missing on first run)
  env: SFTP_HOST, SFTP_PORT, SFTP_USER, SFTP_PASS, SFTP_REMOTE_PATH

Outputs:
  /output/result.json
    {
      "listing":      [{filename, size, mtime}, ...],   # current SFTP state
      "newFiles":     [...],                            # entries not in previousListing
      "missingFiles": [...],                            # entries gone from SFTP since last run
      "deliveryId":   "d-<unix-ts>" or null,            # null when no newFiles
      "deliveryDir":  "incoming/d-<ts>" or null
    }
  /workspace/incoming/{deliveryId}/*  — downloaded files (only when newFiles)
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import TypedDict

import paramiko

OUTPUT = Path("/output")
WORKSPACE = Path("/workspace")


class FileEntry(TypedDict):
    filename: str
    size: int
    mtime: int


def load_previous_listing() -> list[FileEntry]:
    previous = OUTPUT / "previous_run.json"
    if not previous.exists():
        return []
    payload = json.loads(previous.read_text())
    raw = payload.get("previousListing")
    if not isinstance(raw, list):
        return []
    return raw


def list_remote(sftp: paramiko.SFTPClient, remote_path: str) -> list[FileEntry]:
    listing: list[FileEntry] = []
    for attr in sftp.listdir_attr(remote_path):
        mode = attr.st_mode or 0
        if mode & 0o040000:
            continue
        filename = attr.filename
        size = attr.st_size or 0
        mtime = int(attr.st_mtime or 0)
        listing.append({"filename": filename, "size": size, "mtime": mtime})
    listing.sort(key=lambda entry: entry["filename"])
    return listing


def diff(current: list[FileEntry], previous: list[FileEntry]) -> tuple[list[FileEntry], list[FileEntry]]:
    previous_keys = {(entry["filename"], entry["size"], entry["mtime"]) for entry in previous}
    new_files = [entry for entry in current if (entry["filename"], entry["size"], entry["mtime"]) not in previous_keys]
    current_names = {entry["filename"] for entry in current}
    missing_files = [entry for entry in previous if entry["filename"] not in current_names]
    return new_files, missing_files


def download(sftp: paramiko.SFTPClient, remote_path: str, files: list[FileEntry]) -> tuple[str, str]:
    delivery_id = f"d-{int(time.time())}"
    incoming = WORKSPACE / "incoming" / delivery_id
    incoming.mkdir(parents=True, exist_ok=True)
    for entry in files:
        remote_file = f"{remote_path.rstrip('/')}/{entry['filename']}"
        local_file = incoming / entry["filename"]
        sftp.get(remote_file, str(local_file))
    return delivery_id, str(incoming.relative_to(WORKSPACE))


def main() -> None:
    host = os.environ["SFTP_HOST"]
    port = int(os.environ.get("SFTP_PORT", "22"))
    user = os.environ["SFTP_USER"]
    password = os.environ.get("SFTP_PASS", "")
    remote_path = os.environ.get("SFTP_REMOTE_PATH", "/upload")

    previous_listing = load_previous_listing()

    transport = paramiko.Transport((host, port))
    transport.connect(username=user, password=password)
    sftp = paramiko.SFTPClient.from_transport(transport)
    if sftp is None:
        raise RuntimeError("Failed to open SFTP channel")

    try:
        listing = list_remote(sftp, remote_path)
        new_files, missing_files = diff(listing, previous_listing)

        delivery_id: str | None = None
        delivery_dir: str | None = None
        if new_files:
            delivery_id, delivery_dir = download(sftp, remote_path, new_files)
    finally:
        sftp.close()
        transport.close()

    result = {
        "listing": listing,
        "newFiles": new_files,
        "missingFiles": missing_files,
        "deliveryId": delivery_id,
        "deliveryDir": delivery_dir,
    }
    (OUTPUT / "result.json").write_text(json.dumps(result, indent=2))
    print(
        f"sftp-poll: {len(listing)} on server, "
        f"{len(new_files)} new, {len(missing_files)} missing"
        + (f" — downloaded to {delivery_dir}" if delivery_dir else ""),
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
