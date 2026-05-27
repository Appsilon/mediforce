"""Firestore -> Postgres cutover verification (ADR-0001 §8.2 step 5).

- Per-table row counts: Firestore collection count vs Postgres row count.
- 50 random Firestore docs per table, compared field-by-field against the
  matching Postgres row.

Exits non-zero if any count mismatches or sampled-row diff fields exist.
"""

from __future__ import annotations

import argparse
import json
import logging
import random
import sys
from datetime import datetime
from typing import Any

import firebase_admin
import psycopg2
import psycopg2.extras
from firebase_admin import credentials, firestore

LOG = logging.getLogger("verify")


# (firestore_collection, postgres_table, lookup_kind)
#   lookup_kind = how to find the matching Postgres row given a Firestore doc:
#     - 'id'          : Postgres pk is text and equals Firestore doc id
#     - 'composite'   : pk is (namespace,name,version) etc; passed via field map
#     - 'no_verify'   : table inserted with new uuids; skip diff (count only)
#     - 'count_only'  : sub-collection — count via collection_group; no diff
#
# Sub-collection rows use a leading 'cg:' prefix on the collection name to
# signal `collection_group` counting in count_firestore.
TABLES: list[tuple[str, str, str]] = [
    ("namespaces", "workspaces", "handle"),
    ("agentDefinitions", "agents", "id"),
    ("modelRegistry", "model_registry_entries", "id"),
    ("workflowDefinitions", "workflow_definitions", "composite_wd"),
    ("workflowMeta", "workflow_meta", "composite_wm"),
    ("processInstances", "process_instances", "id"),
    ("cg:stepExecutions", "step_executions", "id"),
    ("cg:agentEvents", "agent_events", "id"),
    ("auditEvents", "audit_events", "no_verify"),
    ("agentRuns", "agent_runs", "no_verify"),
    ("humanTasks", "human_tasks", "no_verify"),
    ("handoffEntities", "handoff_entities", "no_verify"),
    ("coworkSessions", "cowork_sessions", "id"),
    ("cg:turns", "cowork_turns", "count_only"),
    ("cg:members", "workspace_members", "count_only"),
    ("cg:namespaceSecrets", "namespace_secrets", "count_only"),
    ("cg:workflowSecrets", "workflow_secrets", "count_only"),
    ("cg:toolCatalog", "tool_catalog_entries", "count_only"),
    ("cg:oauthProviders", "oauth_providers", "count_only"),
    ("cg:agentOAuthTokens", "agent_oauth_tokens", "count_only"),
    ("cronTriggerState", "cron_trigger_state", "composite_cron"),
]


def count_firestore(fs: Any, collection: str) -> int:
    if collection.startswith("cg:"):
        return sum(1 for _ in fs.collection_group(collection[3:]).stream())
    return sum(1 for _ in fs.collection(collection).stream())


def count_pg(pg: Any, table: str) -> int:
    with pg.cursor() as cur:
        cur.execute(f'SELECT count(*) FROM "{table}"')
        return cur.fetchone()[0]


def fetch_pg_row(pg: Any, table: str, where: dict[str, Any]) -> dict[str, Any] | None:
    clauses = " AND ".join(f'"{k}" = %s' for k in where.keys())
    sql = f'SELECT * FROM "{table}" WHERE {clauses} LIMIT 1'
    with pg.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, list(where.values()))
        row = cur.fetchone()
        return dict(row) if row else None


def diff_fields(fs_data: dict, pg_row: dict, field_map: dict[str, str]) -> list[str]:
    """Compare a Firestore document and a Postgres row. Returns differing field names."""
    diffs: list[str] = []
    for fs_field, pg_col in field_map.items():
        fs_val = _normalize(fs_data.get(fs_field))
        pg_val = _normalize(pg_row.get(pg_col))
        if fs_val != pg_val:
            diffs.append(f"{fs_field}<>{pg_col}: fs={fs_val!r} pg={pg_val!r}")
    return diffs


def _normalize(v: Any) -> Any:
    if isinstance(v, datetime):
        # Compare second-precision UTC to side-step Firestore micro / pg micro gaps.
        return v.astimezone().isoformat(timespec="seconds")
    if isinstance(v, dict):
        return json.dumps(v, sort_keys=True, default=str)
    if isinstance(v, list):
        return json.dumps(v, sort_keys=True, default=str)
    return v


# Per-collection field maps. Only a handful of representative fields per
# table — enough to catch a structural mismatch without being a full schema
# duplication.
FIELD_MAPS: dict[str, dict[str, str]] = {
    "namespaces": {"type": "type", "displayName": "display_name", "linkedUserId": "linked_user_id"},
    "agentDefinitions": {
        "name": "name",
        "foundationModel": "foundation_model",
        "systemPrompt": "system_prompt",
    },
    "modelRegistry": {
        "name": "name",
        "provider": "provider",
        "contextLength": "context_length",
    },
    "workflowDefinitions": {
        "name": "name",
        "version": "version",
        "title": "title",
        "visibility": "visibility",
    },
    "workflowMeta": {"defaultVersion": "default_version", "hidden": "hidden"},
    "processInstances": {
        "definitionName": "definition_name",
        "status": "status",
        "currentStepId": "current_step_id",
    },
    "coworkSessions": {
        "stepId": "step_id",
        "assignedRole": "assigned_role",
        "status": "status",
        "agent": "agent",
    },
    "cg:stepExecutions": {
        "stepId": "step_id",
        "status": "status",
        "iterationNumber": "iteration_number",
    },
    "cg:agentEvents": {
        "stepId": "step_id",
        "type": "type",
        "sequence": "sequence",
    },
    "cronTriggerState": {"lastTriggeredAt": "last_triggered_at"},
}


def sample_diff(
    fs: Any, pg: Any, collection: str, table: str, lookup: str, sample: int
) -> tuple[int, int, list[str]]:
    """Sample up to `sample` Firestore docs and diff against Postgres. Returns
    (sampled, mismatched, error_messages)."""
    if lookup == "no_verify":
        return 0, 0, ["skipped: table inserted with synthetic UUIDs, no natural key"]
    if lookup == "count_only":
        return 0, 0, ["skipped: count-only sub-collection (composite/synthetic PK)"]

    field_map = FIELD_MAPS.get(collection, {})
    if not field_map:
        return 0, 0, [f"skipped: no FIELD_MAPS entry for {collection}"]

    if collection.startswith("cg:"):
        all_docs = list(fs.collection_group(collection[3:]).stream())
    else:
        all_docs = list(fs.collection(collection).stream())
    if not all_docs:
        return 0, 0, []
    picked = random.sample(all_docs, min(sample, len(all_docs)))

    mismatches: list[str] = []
    for doc in picked:
        data = doc.to_dict() or {}
        where = _build_where(collection, doc.id, data, lookup)
        if where is None:
            mismatches.append(f"{doc.id}: cannot build PG lookup key")
            continue
        pg_row = fetch_pg_row(pg, table, where)
        if not pg_row:
            mismatches.append(f"{doc.id}: not found in postgres by {where}")
            continue
        diffs = diff_fields(data, pg_row, field_map)
        if diffs:
            mismatches.append(f"{doc.id}: {'; '.join(diffs)}")

    return len(picked), len(mismatches), mismatches


def _build_where(
    collection: str, doc_id: str, data: dict, lookup: str
) -> dict[str, Any] | None:
    if lookup == "id":
        # The Postgres PK column name varies per table; rather than carry
        # another map, build it inline. workspaces -> handle, others -> id.
        pk_col = "handle" if collection == "namespaces" else "id"
        return {pk_col: doc_id}
    if lookup == "composite_wd":
        ws = data.get("namespace") or data.get("workspace")
        return {"workspace": ws, "name": data.get("name"), "version": int(data.get("version") or 1)}
    if lookup == "composite_wm":
        ws = data.get("namespace") or data.get("workspace") or doc_id.split(":", 1)[0]
        name = data.get("name") or (doc_id.split(":", 1)[1] if ":" in doc_id else None)
        return {"workspace": ws, "name": name}
    if lookup == "composite_cron":
        def_name = data.get("definitionName") or doc_id.split(":", 1)[0]
        trigger_name = data.get("triggerName") or (
            doc_id.split(":", 1)[1] if ":" in doc_id else None
        )
        return {"definition_name": def_name, "trigger_name": trigger_name}
    return None


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--firebase-project", required=True)
    p.add_argument("--database-url", required=True)
    p.add_argument("--sample", type=int, default=50)
    p.add_argument("--only", help="Comma-separated postgres table names to verify.")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": args.firebase_project})
    fs = firestore.client()
    pg = psycopg2.connect(args.database_url)

    only = set(args.only.split(",")) if args.only else None
    report: dict[str, dict[str, Any]] = {}
    any_fail = False

    for collection, table, lookup in TABLES:
        if only is not None and table not in only:
            continue
        LOG.info("=== verifying %s -> %s ===", collection, table)
        fs_count = count_firestore(fs, collection)
        pg_count = count_pg(pg, table)
        sampled, mismatched, messages = sample_diff(
            fs, pg, collection, table, lookup, args.sample
        )
        passed = (fs_count == pg_count) and (mismatched == 0)
        if not passed:
            any_fail = True
        report[table] = {
            "fs_count": fs_count,
            "pg_count": pg_count,
            "sampled": sampled,
            "mismatched": mismatched,
            "messages": messages[:10],  # truncate noise
            "passed": passed,
        }
        LOG.info("%s: %s", table, report[table])

    pg.close()
    print(json.dumps(report, indent=2, default=str))
    if any_fail:
        LOG.error("verification FAILED")
        return 1
    LOG.info("verification PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
