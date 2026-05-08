#!/usr/bin/env python3
"""
Migrate Firestore workflow definition document IDs from the old
global format ({name}:{version}) to the namespace-scoped format
({namespace}:{name}:{version}).

Documents already in the new format are skipped (idempotent).

For each old-format document:
  1. Read the `namespace` field from the document data
  2. Create a new document with ID `{namespace}:{name}:{version}`
  3. Delete the old document

Also migrates `workflowMeta` documents from `{name}` to
`{namespace}:{name}` when the namespace can be resolved from
the corresponding workflow definition.

Usage:
    # Dry run — lists documents that would be migrated
    python3 scripts/migrations/migrate_workflow_doc_ids.py \
        --project demo-mediforce

    # Apply — actually re-keys the documents
    python3 scripts/migrations/migrate_workflow_doc_ids.py \
        --project demo-mediforce --apply

    # Target staging
    python3 scripts/migrations/migrate_workflow_doc_ids.py \
        --project mediforce-staging --apply

Environment:
    GOOGLE_APPLICATION_CREDENTIALS  Path to service account JSON
                                    (not needed for emulator mode)
    FIRESTORE_EMULATOR_HOST         Set to use local emulator
                                    (e.g. localhost:8080)
"""

import argparse
import os
import sys


def is_old_format_wd(doc_id: str) -> bool:
    """Old format: {name}:{version} — exactly one colon, last segment is a number."""
    parts = doc_id.split(":")
    if len(parts) != 2:
        return False
    try:
        int(parts[-1])
        return True
    except ValueError:
        return False


def is_old_format_meta(doc_id: str) -> bool:
    """Old format for workflowMeta: just {name} — no colon at all."""
    return ":" not in doc_id


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Migrate workflow definition doc IDs to namespace-scoped format"
    )
    parser.add_argument(
        "--project",
        required=True,
        help="Firebase project ID (e.g. demo-mediforce, mediforce-staging)",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually apply changes (default: dry run)",
    )
    args = parser.parse_args()

    # Late import — firebase_admin is only needed at runtime
    try:
        import firebase_admin  # type: ignore
        from firebase_admin import credentials, firestore  # type: ignore
    except ImportError:
        print(
            "ERROR: firebase-admin is required. Install with:\n"
            "  pip install firebase-admin",
            file=sys.stderr,
        )
        return 1

    # Initialize Firebase
    emulator_host = os.environ.get("FIRESTORE_EMULATOR_HOST")
    if emulator_host:
        print(f"Using Firestore emulator at {emulator_host}")
        app = firebase_admin.initialize_app(options={"projectId": args.project})
    else:
        cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if cred_path:
            cred = credentials.Certificate(cred_path)
        else:
            cred = credentials.ApplicationDefault()
        app = firebase_admin.initialize_app(cred, {"projectId": args.project})

    db = firestore.client(app)

    # ── Phase 1: workflowDefinitions ──────────────────────────────────────────
    print("\n=== workflowDefinitions ===\n")
    wd_collection = db.collection("workflowDefinitions")
    wd_docs = wd_collection.stream()

    old_wd_docs = []
    new_wd_docs = 0
    skipped_no_namespace = 0

    for doc in wd_docs:
        doc_id = doc.id
        if is_old_format_wd(doc_id):
            data = doc.to_dict()
            namespace = data.get("namespace")
            if not namespace:
                print(f"  SKIP {doc_id} — no namespace field in document data")
                skipped_no_namespace += 1
                continue
            name = data.get("name", doc_id.rsplit(":", 1)[0])
            version = data.get("version", doc_id.rsplit(":", 1)[1])
            new_id = f"{namespace}:{name}:{version}"
            old_wd_docs.append((doc_id, new_id, data))
        else:
            new_wd_docs += 1

    print(f"  Already migrated: {new_wd_docs}")
    print(f"  Needs migration:  {len(old_wd_docs)}")
    if skipped_no_namespace > 0:
        print(f"  Skipped (no ns):  {skipped_no_namespace}")

    for old_id, new_id, _ in old_wd_docs:
        print(f"  {old_id}  ->  {new_id}")

    # ── Phase 2: workflowMeta ─────────────────────────────────────────────────
    # Build a name->namespace map from the workflow definitions we just scanned.
    name_to_namespace: dict[str, str] = {}
    # Use already-migrated docs and to-be-migrated docs
    for _, new_id, data in old_wd_docs:
        ns = data.get("namespace")
        name = data.get("name")
        if ns and name:
            name_to_namespace[name] = ns

    # Also scan already-new-format docs for the namespace map
    if new_wd_docs > 0:
        for doc in wd_collection.stream():
            if not is_old_format_wd(doc.id):
                data = doc.to_dict()
                ns = data.get("namespace")
                name = data.get("name")
                if ns and name:
                    name_to_namespace[name] = ns

    print("\n=== workflowMeta ===\n")
    meta_collection = db.collection("workflowMeta")
    meta_docs = list(meta_collection.stream())

    old_meta_docs = []
    new_meta_docs = 0

    for doc in meta_docs:
        doc_id = doc.id
        if is_old_format_meta(doc_id):
            data = doc.to_dict()
            namespace = name_to_namespace.get(doc_id)
            if not namespace:
                print(f"  SKIP {doc_id} — cannot resolve namespace")
                continue
            new_id = f"{namespace}:{doc_id}"
            old_meta_docs.append((doc_id, new_id, data))
        else:
            new_meta_docs += 1

    print(f"  Already migrated: {new_meta_docs}")
    print(f"  Needs migration:  {len(old_meta_docs)}")

    for old_id, new_id, _ in old_meta_docs:
        print(f"  {old_id}  ->  {new_id}")

    # ── Summary ───────────────────────────────────────────────────────────────
    total = len(old_wd_docs) + len(old_meta_docs)
    if total == 0:
        print("\nNothing to migrate. All documents are already in the new format.")
        return 0

    if not args.apply:
        print(
            f"\nDry run — {total} document(s) would be migrated. "
            f"Pass --apply to execute."
        )
        return 0

    # ── Apply ─────────────────────────────────────────────────────────────────
    print(f"\nApplying migration for {total} document(s)...")

    errors = 0

    # Migrate workflowDefinitions
    for old_id, new_id, data in old_wd_docs:
        try:
            # Write new doc, then delete old — if the new doc already exists
            # from a partial previous run, the set() is a no-op overwrite.
            wd_collection.document(new_id).set(data)
            wd_collection.document(old_id).delete()
            print(f"  OK  {old_id}  ->  {new_id}")
        except Exception as exc:
            print(f"  ERR {old_id}: {exc}")
            errors += 1

    # Migrate workflowMeta
    for old_id, new_id, data in old_meta_docs:
        try:
            meta_collection.document(new_id).set(data)
            meta_collection.document(old_id).delete()
            print(f"  OK  {old_id}  ->  {new_id}")
        except Exception as exc:
            print(f"  ERR {old_id}: {exc}")
            errors += 1

    if errors > 0:
        print(f"\nDone with {errors} error(s). Re-run to retry failed documents.")
        return 1

    print(f"\nDone. {total} document(s) migrated successfully.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
