#!/usr/bin/env python3
"""
Backfill `deleted: false` on `processInstances` docs that lack the field.

The field was introduced 2026-04-23 with the soft-delete tombstone work
(commit 9ff9cb00). Pre-feature docs do not carry it. Phase-4 PR3 extends
the server-side filter `.where('deleted','==',false)` to the user-facing
runs list (`listAll` / `listInNamespaces`). Firestore equality
where-clauses do NOT match docs missing the field, so legacy docs are
hidden from `/[handle]/runs` until backfilled.

Idempotent — re-runs are no-ops once every doc has the field.

Auth: Application Default Credentials. Run once:
    gcloud auth application-default login

Usage:
    # Dry run (default) — counts affected docs, prints a sample
    python3 scripts/migrations/backfill_process_instance_deleted.py \\
        --project mediforce-1c761

    # Apply
    python3 scripts/migrations/backfill_process_instance_deleted.py \\
        --project mediforce-1c761 --apply
"""

import argparse
import sys
from google.cloud import firestore


BATCH_SIZE = 400  # Firestore commit cap is 500 writes per batch.


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill deleted:false on processInstances missing the field"
    )
    parser.add_argument("--project", required=True, help="GCP project id (e.g. mediforce-1c761)")
    parser.add_argument("--apply", action="store_true", help="Actually write (default: dry run)")
    parser.add_argument("--sample", type=int, default=10, help="Sample doc ids to print")
    args = parser.parse_args()

    db = firestore.Client(project=args.project)
    col = db.collection("processInstances")

    total = 0
    missing_ids: list[str] = []
    has_field = 0

    for snap in col.stream():
        total += 1
        data = snap.to_dict() or {}
        if "deleted" in data:
            has_field += 1
        else:
            missing_ids.append(snap.id)

    print(f"Project: {args.project}")
    print(f"Total processInstances: {total}")
    print(f"  has `deleted`:     {has_field}")
    print(f"  missing `deleted`: {len(missing_ids)}")

    if not missing_ids:
        print("Nothing to backfill.")
        return 0

    print("\nSample missing ids:")
    for i in missing_ids[: args.sample]:
        print(f"  {i}")
    if len(missing_ids) > args.sample:
        print(f"  ... and {len(missing_ids) - args.sample} more")

    if not args.apply:
        print("\nDry run. Re-run with --apply to set `deleted: false` on the above.")
        return 0

    print(f"\nApplying `deleted: false` to {len(missing_ids)} docs in batches of {BATCH_SIZE}...")
    written = 0
    for start in range(0, len(missing_ids), BATCH_SIZE):
        chunk = missing_ids[start : start + BATCH_SIZE]
        batch = db.batch()
        for doc_id in chunk:
            batch.update(col.document(doc_id), {"deleted": False})
        batch.commit()
        written += len(chunk)
        print(f"  committed {written}/{len(missing_ids)}")

    print(f"\nDone. {written} docs updated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
