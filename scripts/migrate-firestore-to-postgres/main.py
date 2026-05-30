"""Firestore -> Postgres one-shot data migration (ADR-0001 §8.2 step 4).

Streams every documented Firestore collection into the matching Postgres
table using INSERT ... ON CONFLICT DO NOTHING for idempotency. Writes per-
table counts to `migration_log.json` for audit.

Mapping ground truth: `packages/platform-infra/src/postgres/schema/*.ts`.
"""

from __future__ import annotations

import argparse
import json
import logging
import re
import sys
from collections.abc import Iterable, Iterator
from datetime import datetime, timezone
from typing import Any, Callable

import firebase_admin
import psycopg2
import psycopg2.extras
from firebase_admin import credentials, firestore

LOG = logging.getLogger("migrate")


# ---------- mapping table -----------------------------------------------------

# Top-level Firestore collection -> Postgres table. Sub-collections are
# walked from their parents inside per-table functions (see process_instances
# and namespaces below).
COLLECTION_TABLE_MAP: dict[str, str] = {
    "namespaces": "workspaces",
    "agentDefinitions": "agents",
    "modelRegistry": "model_registry_entries",
    "workflowDefinitions": "workflow_definitions",
    "workflowMeta": "workflow_meta",
    "processInstances": "process_instances",
    "cronTriggerState": "cron_trigger_state",
    "users": "user_profiles",
}


# ---------- utilities ---------------------------------------------------------


def snake(s: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", s).lower()


def _strip_nul(v: Any) -> Any:
    """Recursively remove NUL (\\u0000) bytes from strings.

    Postgres `text` and `jsonb` cannot store the NUL code point — some
    Firestore docs carry it (e.g. an agentEvents `payload` holding a binary
    blob whose ZIP header `PK\\x03\\x04` decoded with embedded NULs). Stripping
    it is the only option; no column type accepts it.
    """
    if isinstance(v, str):
        return v.replace("\x00", "") if "\x00" in v else v
    if isinstance(v, dict):
        return {k: _strip_nul(val) for k, val in v.items()}
    if isinstance(v, list):
        return [_strip_nul(item) for item in v]
    return v


def to_pg_value(v: Any, *, as_text_array: bool = False, force_json: bool = False) -> Any:
    """Coerce a Firestore-decoded Python value into a Postgres-ready value.

    `as_text_array=True` opts the value out of JSON-wrapping so psycopg2
    adapts a Python list to a Postgres `text[]` literal.

    `force_json=True` marks a `jsonb` target column: scalar values (str, int,
    bool) are wrapped in `Json` too, so e.g. an agentEvents `payload` of the
    bare string `starting` lands as the JSON string `"starting"` instead of
    failing the jsonb parse. Without this, only dict/list values get wrapped.
    """
    if v is None:
        return None
    # Firestore timestamps decode to datetime.datetime; psycopg2 handles them.
    if isinstance(v, datetime):
        if v.tzinfo is None:
            return v.replace(tzinfo=timezone.utc)
        return v
    v = _strip_nul(v)
    if as_text_array and isinstance(v, list):
        # Let psycopg2 adapt list -> ARRAY for text[] columns.
        return v
    if force_json:
        return psycopg2.extras.Json(v)
    if isinstance(v, (dict, list)):
        return psycopg2.extras.Json(v)
    return v


def fs_iter_collection(fs: Any, path: str) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (doc_id, data) tuples by streaming a Firestore collection."""
    for doc in fs.collection(path).stream():
        yield doc.id, doc.to_dict() or {}


def fs_iter_subcollection(
    fs: Any, parent_path: str, parent_id: str, sub_name: str
) -> Iterator[tuple[str, dict[str, Any]]]:
    for doc in fs.collection(parent_path).document(parent_id).collection(sub_name).stream():
        yield doc.id, doc.to_dict() or {}


def insert_rows(
    pg: psycopg2.extensions.connection,
    table: str,
    rows: list[dict[str, Any]],
    *,
    conflict: str | None,
    dry_run: bool,
    text_array_columns: set[str] | None = None,
    json_columns: set[str] | None = None,
) -> tuple[int, int]:
    """Insert `rows` with ON CONFLICT DO NOTHING. Returns (inserted, skipped).

    `text_array_columns` names columns whose Python-list values should be
    passed through to psycopg2 unwrapped, so they land as Postgres `text[]`
    instead of JSON.

    `json_columns` names `jsonb` columns that may receive scalar values
    (e.g. a `payload` that is sometimes a bare string) — those are JSON-wrapped
    unconditionally so the scalar parses as valid jsonb.
    """
    if not rows:
        return 0, 0
    text_array_cols = text_array_columns or set()
    json_cols = json_columns or set()
    conflict_clause = ""
    if conflict:
        conflict_clause = f" ON CONFLICT ({conflict}) DO NOTHING"
    if dry_run:
        LOG.info("[dry-run] %s rows -> %s; first row: %s", len(rows), table, rows[0])
        return 0, 0
    inserted = 0
    skipped = 0
    with pg.cursor() as cur:
        for row in rows:
            # `_strip_none_defaults` drops None keys per-row, so each row may
            # carry a different column set. Build the column list and SQL from
            # *this* row's keys — omitted columns fall through to DB defaults.
            cols = list(row.keys())
            placeholders = ",".join(["%s"] * len(cols))
            col_list = ",".join(f'"{c}"' for c in cols)
            sql = (
                f'INSERT INTO "{table}" ({col_list}) '
                f"VALUES ({placeholders}){conflict_clause}"
            )
            cur.execute(
                sql,
                [
                    to_pg_value(
                        row[c],
                        as_text_array=c in text_array_cols,
                        force_json=c in json_cols,
                    )
                    for c in cols
                ],
            )
            # rowcount is 1 when inserted, 0 when ON CONFLICT skipped it.
            if cur.rowcount == 1:
                inserted += 1
            else:
                skipped += 1
        pg.commit()
    return inserted, skipped


def batched(it: Iterable[Any], n: int) -> Iterator[list[Any]]:
    batch: list[Any] = []
    for item in it:
        batch.append(item)
        if len(batch) >= n:
            yield batch
            batch = []
    if batch:
        yield batch


# ---------- per-table migrations ---------------------------------------------
#
# Each function:
#   - reads from the relevant Firestore collection(s),
#   - maps each doc to one or more Postgres rows,
#   - calls insert_rows with the table's conflict key,
#   - returns dict {'inserted': N, 'skipped': N, 'errors': N}.
#
# Workspace derivation: rows whose parent doc lives at
# `processInstances/{id}` read `instance.namespace` once via a cache built
# at the start of the run (build_workspace_cache).


def _result(inserted: int, skipped: int, errors: int = 0) -> dict[str, int]:
    return {"inserted": inserted, "skipped": skipped, "errors": errors}


def load_workspace_handles(pg: Any) -> set[str]:
    """Return the set of workspace handles that exist in Postgres.

    Parent tables carry a `workspace` FK to `workspaces.handle`. Some Firestore
    docs reference a handle that has no `namespaces/{handle}` doc (deleted
    workspace, casing drift like `Appsilon` vs `appsilon`, or a missing value).
    A single such row would abort the whole table's transaction on the FK, so
    callers filter rows against this set and count the drops as orphan
    `errors` — the same skip-to-errors pattern the child-table migrations use.
    Runs after `workspaces` is populated, so it sees the migrated handles plus
    any pre-seeded ones.
    """
    with pg.cursor() as cur:
        cur.execute("SELECT handle FROM workspaces")
        return {r[0] for r in cur.fetchall()}


def load_process_instance_ids(pg: Any) -> set[str]:
    """Return the set of process_instance ids that exist in Postgres.

    Several child collections (`auditEvents`, `agentRuns`, `humanTasks`,
    `coworkSessions`) carry a `processInstanceId` that points at a run which
    was never migrated — either an orphan-workspace instance we dropped, or a
    Firestore id that has no `processInstances/{id}` doc at all (pre-cutover
    backfill drift). Such a reference would violate the FK to
    `process_instances.id`. Callers null it (when the column is nullable) or
    drop the row (when it is notNull) using this set. Runs after
    `process_instances` is populated.
    """
    with pg.cursor() as cur:
        cur.execute("SELECT id FROM process_instances")
        return {r[0] for r in cur.fetchall()}


def _filter_orphan_workspaces(
    rows: list[dict[str, Any]], valid: set[str], table: str
) -> tuple[list[dict[str, Any]], int]:
    """Drop rows whose `workspace` is missing or not a known handle.

    Returns (kept_rows, orphan_count). Orphans are logged + reported as
    `errors` so verify.py reconciles fs == pg + skipped.
    """
    kept: list[dict[str, Any]] = []
    orphans = 0
    for row in rows:
        ws = row.get("workspace")
        if not ws or ws not in valid:
            print(f"WARN: skipping {table} row — orphan workspace {ws!r}")
            orphans += 1
            continue
        kept.append(row)
    return kept, orphans


def _filter_orphan_children(
    rows: list[dict[str, Any]], kept_parent_ids: set[str], table: str
) -> tuple[list[dict[str, Any]], int]:
    """Drop child rows whose parent process_instance was itself dropped.

    Returns (kept_rows, orphan_count). Keeps the FK to process_instances.id
    satisfiable when an orphan-workspace parent is skipped.
    """
    kept: list[dict[str, Any]] = []
    orphans = 0
    for row in rows:
        if row.get("process_instance_id") not in kept_parent_ids:
            orphans += 1
            continue
        kept.append(row)
    return kept, orphans


def build_workspace_cache(fs: Any) -> dict[str, str]:
    """Cache process_instance_id -> namespace so children can derive workspace."""
    cache: dict[str, str] = {}
    for doc_id, data in fs_iter_collection(fs, "processInstances"):
        ns = data.get("namespace")
        if ns:
            cache[doc_id] = ns
    LOG.info("workspace cache built: %s process instances", len(cache))
    return cache


def migrate_namespaces(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """namespaces -> workspaces (+ workspace_members from sub-collection)."""
    ws_rows: list[dict[str, Any]] = []
    member_rows: list[dict[str, Any]] = []
    for handle, data in fs_iter_collection(fs, "namespaces"):
        ws_rows.append(
            {
                "handle": handle,
                "type": data.get("type") or "personal",
                "display_name": data.get("displayName") or handle,
                "avatar_url": data.get("avatarUrl"),
                "icon": data.get("icon"),
                "linked_user_id": data.get("linkedUserId"),
                "bio": data.get("bio"),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
        for uid, mdata in fs_iter_subcollection(fs, "namespaces", handle, "members"):
            member_rows.append(
                {
                    "workspace": handle,
                    "uid": uid,
                    "role": mdata.get("role") or "member",
                    "display_name": mdata.get("displayName"),
                    "avatar_url": mdata.get("avatarUrl"),
                    "joined_at": mdata.get("joinedAt"),
                }
            )
    ins_ws, skip_ws = insert_rows(
        pg, "workspaces", _strip_none_defaults(ws_rows), conflict="handle", dry_run=dry_run
    )
    ins_m, skip_m = insert_rows(
        pg,
        "workspace_members",
        _strip_none_defaults(member_rows),
        conflict="workspace, uid",
        dry_run=dry_run,
    )
    return _result(ins_ws + ins_m, skip_ws + skip_m)


def migrate_agents(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """agentDefinitions -> agents (id preserved)."""
    rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "agentDefinitions"):
        rows.append(
            {
                "id": doc_id,
                "workspace": data.get("workspace") or data.get("namespace"),
                "kind": data.get("kind") or "plugin",
                "runtime_id": data.get("runtimeId"),
                "name": data.get("name"),
                "icon_name": data.get("iconName") or "robot",
                "description": data.get("description") or "",
                "foundation_model": data.get("foundationModel") or "",
                "system_prompt": data.get("systemPrompt") or "",
                "input_description": data.get("inputDescription") or "",
                "output_description": data.get("outputDescription") or "",
                "skill_file_names": data.get("skillFileNames") or [],
                "mcp_servers": data.get("mcpServers"),
                "namespace": data.get("namespace"),
                "visibility": data.get("visibility") or "private",
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
    valid = load_workspace_handles(pg)
    rows, orphans = _filter_orphan_workspaces(rows, valid, "agents")
    ins, skip = insert_rows(
        pg, "agents", _strip_none_defaults(rows), conflict="id", dry_run=dry_run
    )
    return _result(ins, skip, orphans)


def migrate_model_registry(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    meta_rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "modelRegistry"):
        if doc_id == "_meta":
            meta_rows.append(
                {
                    "id": "singleton",
                    "rankings_updated_at": data.get("rankingsUpdatedAt"),
                }
            )
            continue
        rows.append(
            {
                "id": doc_id,
                "canonical_slug": data.get("canonicalSlug"),
                "name": data.get("name") or doc_id,
                "provider": data.get("provider") or "unknown",
                "context_length": data.get("contextLength") or 0,
                "max_completion_tokens": data.get("maxCompletionTokens"),
                "pricing": data.get("pricing") or {"input": 0, "output": 0},
                "modality": data.get("modality") or "text",
                "input_modalities": data.get("inputModalities") or ["text"],
                "output_modalities": data.get("outputModalities") or ["text"],
                "supports_tools": bool(data.get("supportsTools")),
                "supports_vision": bool(data.get("supportsVision")),
                "source": data.get("source") or "openrouter",
                "request_count": data.get("requestCount"),
                # `last_synced_at` is notNull-without-default on Postgres. Fall back
                # to epoch zero so operators can spot un-migrated rows in a later
                # audit instead of failing the whole table insert.
                "last_synced_at": data.get("lastSyncedAt")
                or datetime(1970, 1, 1, tzinfo=timezone.utc),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
    ins_e, skip_e = insert_rows(
        pg, "model_registry_entries", _strip_none_defaults(rows), conflict="id", dry_run=dry_run
    )
    ins_m, skip_m = insert_rows(
        pg, "model_registry_meta", _strip_none_defaults(meta_rows), conflict="id", dry_run=dry_run
    )
    return _result(ins_e + ins_m, skip_e + skip_m)


def migrate_workflow_definitions(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "workflowDefinitions"):
        # Firestore id pattern: `${namespace}:${name}:${version}` (composite).
        # Postgres mints its own uuid via default; we DO NOT preserve doc_id.
        workspace = data.get("namespace") or data.get("workspace")
        rows.append(
            {
                "workspace": workspace,
                "name": data.get("name"),
                "version": int(data.get("version") or 1),
                "title": data.get("title"),
                "description": data.get("description"),
                "preamble": data.get("preamble"),
                "visibility": data.get("visibility") or "private",
                "steps": data.get("steps") or [],
                "transitions": data.get("transitions") or [],
                "triggers": data.get("triggers") or [],
                "trigger_input": data.get("triggerInput"),
                "roles": data.get("roles"),
                "env": data.get("env"),
                "notifications": data.get("notifications"),
                "git_workspace": data.get("workspace") if isinstance(data.get("workspace"), dict) else None,
                "metadata": data.get("metadata"),
                "repo": data.get("repo"),
                "url": data.get("url"),
                "copied_from": data.get("copiedFrom"),
                "input_for_next_run": data.get("inputForNextRun"),
                "archived_at": _bool_to_tombstone(data.get("archived"), data.get("archivedAt")),
                "deleted_at": _bool_to_tombstone(data.get("deleted"), data.get("deletedAt")),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
    valid = load_workspace_handles(pg)
    rows, orphans = _filter_orphan_workspaces(rows, valid, "workflow_definitions")
    # The unique constraint is (workspace, name, version) — use it as conflict
    # target so re-runs are idempotent on that natural key.
    ins, skip = insert_rows(
        pg,
        "workflow_definitions",
        _strip_none_defaults(rows),
        conflict="workspace, name, version",
        dry_run=dry_run,
    )
    return _result(ins, skip, orphans)


def migrate_workflow_meta(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "workflowMeta"):
        # Firestore doc id pattern: `${namespace}:${name}`.
        workspace = data.get("namespace") or data.get("workspace")
        name = data.get("name")
        if not workspace or not name:
            # Fall back to splitting the composite doc id.
            parts = doc_id.split(":", 1)
            if len(parts) == 2:
                workspace = workspace or parts[0]
                name = name or parts[1]
        rows.append(
            {
                "workspace": workspace,
                "name": name,
                "default_version": data.get("defaultVersion"),
                "hidden": bool(data.get("hidden")),
                "updated_at": data.get("updatedAt"),
            }
        )
    valid = load_workspace_handles(pg)
    rows, orphans = _filter_orphan_workspaces(rows, valid, "workflow_meta")
    ins, skip = insert_rows(
        pg, "workflow_meta", _strip_none_defaults(rows), conflict="workspace, name", dry_run=dry_run
    )
    return _result(ins, skip, orphans)


def migrate_process_instances(
    fs, pg, *, dry_run: bool, ws_cache: dict[str, str]
) -> dict[str, int]:
    """processInstances (+ stepExecutions + agentEvents from sub-collections)."""
    pi_rows: list[dict[str, Any]] = []
    step_rows: list[dict[str, Any]] = []
    event_rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "processInstances"):
        pi_rows.append(
            {
                "id": doc_id,
                "workspace": data.get("namespace"),
                "definition_name": data.get("definitionName"),
                "definition_version": str(data.get("definitionVersion") or "1"),
                "status": data.get("status") or "created",
                "current_step_id": data.get("currentStepId"),
                "variables": data.get("variables") or {},
                "trigger_type": data.get("triggerType") or "manual",
                "trigger_payload": data.get("triggerPayload"),
                "pause_reason": data.get("pauseReason"),
                "error": data.get("error") if isinstance(data.get("error"), str) else (
                    json.dumps(data.get("error")) if data.get("error") else None
                ),
                "assigned_roles": data.get("assignedRoles"),
                "previous_run": data.get("previousRun"),
                "previous_run_source_id": data.get("previousRunSourceId"),
                "total_cost_usd": data.get("totalCostUsd"),
                "created_by": data.get("createdBy"),
                "archived_at": _bool_to_tombstone(data.get("archived"), data.get("archivedAt")),
                "deleted_at": _bool_to_tombstone(data.get("deleted"), data.get("deletedAt")),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
        for sid, sdata in fs_iter_subcollection(fs, "processInstances", doc_id, "stepExecutions"):
            step_rows.append(
                {
                    "id": sid,
                    "process_instance_id": doc_id,
                    "step_id": sdata.get("stepId"),
                    "status": sdata.get("status") or "pending",
                    # Iteration numbering is 0-based — `or 1` would silently
                    # rewrite the legitimate value 0 to 1, so only default a
                    # genuinely-missing field.
                    "iteration_number": int(
                        sdata["iterationNumber"]
                        if sdata.get("iterationNumber") is not None
                        else 1
                    ),
                    "input": sdata.get("input"),
                    "output": sdata.get("output"),
                    "verdict": sdata.get("verdict"),
                    "gate_result": sdata.get("gateResult"),
                    "error": sdata.get("error") if isinstance(sdata.get("error"), str) else (
                        json.dumps(sdata.get("error")) if sdata.get("error") else None
                    ),
                    "review_verdicts": sdata.get("reviewVerdicts"),
                    "agent_output": sdata.get("agentOutput"),
                    "executed_by": sdata.get("executedBy"),
                    "started_at": sdata.get("startedAt"),
                    "completed_at": sdata.get("completedAt"),
                    "created_at": sdata.get("createdAt"),
                }
            )
        for eid, edata in fs_iter_subcollection(fs, "processInstances", doc_id, "agentEvents"):
            event_rows.append(
                {
                    "id": eid,
                    "process_instance_id": doc_id,
                    "step_id": edata.get("stepId"),
                    "type": edata.get("type"),
                    "payload": edata.get("payload"),
                    "sequence": int(edata.get("sequence") or 0),
                    "timestamp": edata.get("timestamp"),
                }
            )
    # Drop instances whose workspace is missing / not a real handle (FK would
    # otherwise abort the whole table), and cascade-drop their step/event
    # children so they don't violate the process_instance_id FK.
    valid = load_workspace_handles(pg)
    pi_rows, pi_orphans = _filter_orphan_workspaces(pi_rows, valid, "process_instances")
    kept_ids = {row["id"] for row in pi_rows}
    # `previous_run_source_id` is a non-deferrable self-FK. Rows arrive in
    # Firestore-stream order, so a run can precede its own
    # previous_run_source_id target in the batch — the per-statement FK check
    # then fails even though the target is in this batch. Defer the column:
    # strip it from the INSERT, stash the (id -> target) pairs, then patch it
    # in a second UPDATE pass once every row exists. Targets outside kept_ids
    # (dropped orphan or non-migrated run) are simply not patched, leaving the
    # column NULL.
    prev_run_links: list[tuple[str, str]] = []
    for row in pi_rows:
        target = row.pop("previous_run_source_id", None)
        if target and target in kept_ids:
            prev_run_links.append((row["id"], target))
    step_rows, step_orphans = _filter_orphan_children(
        step_rows, kept_ids, "step_executions"
    )
    event_rows, event_orphans = _filter_orphan_children(
        event_rows, kept_ids, "agent_events"
    )
    ins_p, skip_p = insert_rows(
        pg,
        "process_instances",
        _strip_none_defaults(pi_rows),
        conflict="id",
        dry_run=dry_run,
        text_array_columns={"assigned_roles"},
    )
    if not dry_run and prev_run_links:
        with pg.cursor() as cur:
            cur.executemany(
                'UPDATE "process_instances" SET previous_run_source_id = %s WHERE id = %s',
                [(target, pid) for pid, target in prev_run_links],
            )
            pg.commit()
    ins_s, skip_s = insert_rows(
        pg,
        "step_executions",
        _strip_none_defaults(step_rows),
        conflict="id",
        dry_run=dry_run,
        # Free-form agent-emitted jsonb columns can hold scalar values.
        json_columns={"input", "output", "gate_result", "agent_output"},
    )
    ins_e, skip_e = insert_rows(
        pg,
        "agent_events",
        _strip_none_defaults(event_rows),
        conflict="id",
        dry_run=dry_run,
        # `payload` is frequently a bare string (e.g. "starting").
        json_columns={"payload"},
    )
    result = _result(ins_p + ins_s + ins_e, skip_p + skip_s + skip_e, pi_orphans)
    # Child tables get their own verify entries — surface their orphan-skipped
    # counts so the driver can fan them out into the migration log.
    result["child_logs"] = {
        "step_executions": _result(ins_s, skip_s, step_orphans),
        "agent_events": _result(ins_e, skip_e, event_orphans),
    }
    return result


def migrate_audit_events(fs, pg, *, dry_run: bool, ws_cache: dict[str, str]) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    errors = 0
    pi_ids = load_process_instance_ids(pg)
    for doc_id, data in fs_iter_collection(fs, "auditEvents"):
        pi_id = data.get("processInstanceId")
        workspace = data.get("workspace") or ws_cache.get(pi_id or "")
        if not workspace:
            print(f"WARN: skipping audit_events doc {doc_id} — no workspace resolvable")
            errors += 1
            continue
        # `process_instance_id` FK is nullable (ON DELETE SET NULL). When the
        # referenced run was never migrated, null it rather than drop the
        # audit row — the row stays valid at workspace level.
        if pi_id and pi_id not in pi_ids:
            pi_id = None
        rows.append(
            {
                "workspace": workspace,
                "actor_id": data.get("actorId") or "unknown",
                "actor_type": data.get("actorType") or "system",
                "actor_role": data.get("actorRole") or "system",
                "action": data.get("action") or "unknown",
                "entity_type": data.get("entityType") or "unknown",
                "entity_id": data.get("entityId") or "unknown",
                "process_instance_id": pi_id,
                "step_id": data.get("stepId"),
                "process_definition_version": (
                    str(data.get("processDefinitionVersion"))
                    if data.get("processDefinitionVersion") is not None
                    else None
                ),
                "executor_type": data.get("executorType"),
                "reviewer_type": data.get("reviewerType"),
                "timestamp": data.get("timestamp"),
                "server_timestamp": data.get("serverTimestamp"),
                "payload": {
                    "description": data.get("description") or "",
                    "basis": data.get("basis") or "",
                    "inputSnapshot": data.get("inputSnapshot") or {},
                    "outputSnapshot": data.get("outputSnapshot") or {},
                },
            }
        )
    # audit_events has no natural unique key besides id (uuid). We can't
    # rerun safely without dedup -- this script is intended for the one-shot
    # cutover so re-running implies a TRUNCATE first (or use --dry-run).
    ins, skip = insert_rows(
        pg, "audit_events", _strip_none_defaults(rows), conflict=None, dry_run=dry_run
    )
    return _result(ins, skip, errors)


def migrate_agent_runs(fs, pg, *, dry_run: bool, ws_cache: dict[str, str]) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    errors = 0
    pi_ids = load_process_instance_ids(pg)
    for doc_id, data in fs_iter_collection(fs, "agentRuns"):
        pi_id = data.get("processInstanceId")
        env = data.get("envelope") or {}
        workspace = data.get("workspace") or ws_cache.get(pi_id or "")
        if not workspace:
            print(f"WARN: skipping agent_runs doc {doc_id} — no workspace resolvable")
            errors += 1
            continue
        # `process_instance_id` FK is notNull — a row pointing at a run we
        # didn't migrate can't be inserted. Drop it as an orphan.
        if not pi_id or pi_id not in pi_ids:
            print(f"WARN: skipping agent_runs doc {doc_id} — orphan process_instance {pi_id!r}")
            errors += 1
            continue
        rows.append(
            {
                "workspace": workspace,
                "process_instance_id": pi_id,
                "step_id": data.get("stepId"),
                "plugin_id": data.get("pluginId") or "unknown",
                "autonomy_level": data.get("autonomyLevel") or "L1",
                "status": data.get("status") or "completed",
                "fallback_reason": data.get("fallbackReason"),
                "confidence": env.get("confidence"),
                "model": env.get("model"),
                "duration_ms": env.get("durationMs"),
                "prompt_tokens": (env.get("usage") or {}).get("promptTokens"),
                "completion_tokens": (env.get("usage") or {}).get("completionTokens"),
                "cost_usd": env.get("costUsd"),
                "envelope_payload": env,
                "executor_type": data.get("executorType"),
                "reviewer_type": data.get("reviewerType"),
                "started_at": data.get("startedAt"),
                "completed_at": data.get("completedAt"),
            }
        )
    ins, skip = insert_rows(
        pg, "agent_runs", _strip_none_defaults(rows), conflict=None, dry_run=dry_run
    )
    return _result(ins, skip, errors)


def migrate_human_tasks(fs, pg, *, dry_run: bool, ws_cache: dict[str, str]) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    errors = 0
    pi_ids = load_process_instance_ids(pg)
    for doc_id, data in fs_iter_collection(fs, "humanTasks"):
        pi_id = data.get("processInstanceId")
        workspace = data.get("workspace") or ws_cache.get(pi_id or "")
        if not workspace:
            print(f"WARN: skipping human_tasks doc {doc_id} — no workspace resolvable")
            errors += 1
            continue
        # `process_instance_id` FK is notNull — drop rows pointing at a run we
        # didn't migrate.
        if not pi_id or pi_id not in pi_ids:
            print(f"WARN: skipping human_tasks doc {doc_id} — orphan process_instance {pi_id!r}")
            errors += 1
            continue
        rows.append(
            {
                # human_tasks.id is `text` PK with NO default — unlike the
                # uuid()/defaultRandom() PKs on audit_events/agent_runs — so the
                # Firestore doc id IS the key. This also makes the table
                # idempotent (conflict target = id).
                "id": doc_id,
                "workspace": workspace,
                "process_instance_id": pi_id,
                "step_id": data.get("stepId"),
                "assigned_role": data.get("assignedRole") or "reviewer",
                "assigned_user_id": data.get("assignedUserId"),
                "status": data.get("status") or "pending",
                "deadline": data.get("deadline"),
                "completion_data": data.get("completionData"),
                "completed_at": data.get("completedAt"),
                "ui": data.get("ui"),
                "params": data.get("params"),
                "selection": data.get("selection"),
                "options": data.get("options"),
                "verdicts": data.get("verdicts"),
                "creation_reason": data.get("creationReason") or "human_executor",
                "deleted_at": _bool_to_tombstone(data.get("deleted"), data.get("deletedAt")),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
    ins, skip = insert_rows(
        pg,
        "human_tasks",
        _strip_none_defaults(rows),
        conflict="id",
        dry_run=dry_run,
        # Free-form jsonb columns can hold scalar values.
        json_columns={
            "completion_data",
            "ui",
            "params",
            "selection",
            "options",
            "verdicts",
        },
    )
    return _result(ins, skip, errors)


def migrate_handoff_entities(fs, pg, *, dry_run: bool, ws_cache: dict[str, str]) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    errors = 0
    pi_ids = load_process_instance_ids(pg)
    for doc_id, data in fs_iter_collection(fs, "handoffEntities"):
        pi_id = data.get("processInstanceId")
        workspace = data.get("workspace") or ws_cache.get(pi_id or "")
        if not workspace:
            print(f"WARN: skipping handoff_entities doc {doc_id} — no workspace resolvable")
            errors += 1
            continue
        # `process_instance_id` FK is notNull — drop rows pointing at a run we
        # didn't migrate.
        if not pi_id or pi_id not in pi_ids:
            print(f"WARN: skipping handoff_entities doc {doc_id} — orphan process_instance {pi_id!r}")
            errors += 1
            continue
        rows.append(
            {
                "workspace": workspace,
                "type": data.get("type") or "review",
                "process_instance_id": pi_id,
                "step_id": data.get("stepId"),
                "agent_run_id": data.get("agentRunId") or "unknown",
                "assigned_role": data.get("assignedRole") or "reviewer",
                "assigned_user_id": data.get("assignedUserId"),
                "status": data.get("status") or "created",
                "agent_work": data.get("agentWork"),
                "agent_reasoning": data.get("agentReasoning"),
                "agent_question": data.get("agentQuestion"),
                "payload": data.get("payload"),
                "resolution": data.get("resolution"),
                "resolved_at": data.get("resolvedAt"),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
    ins, skip = insert_rows(
        pg,
        "handoff_entities",
        _strip_none_defaults(rows),
        conflict=None,
        dry_run=dry_run,
        json_columns={"agent_work", "payload", "resolution"},
    )
    return _result(ins, skip, errors)


def migrate_cowork_sessions(fs, pg, *, dry_run: bool, ws_cache: dict[str, str]) -> dict[str, int]:
    sess_rows: list[dict[str, Any]] = []
    turn_rows: list[dict[str, Any]] = []
    errors = 0
    turn_errors = 0
    pi_ids = load_process_instance_ids(pg)
    for doc_id, data in fs_iter_collection(fs, "coworkSessions"):
        pi_id = data.get("processInstanceId")
        workspace = data.get("workspace") or ws_cache.get(pi_id or "")
        if not workspace:
            print(f"WARN: skipping cowork_sessions doc {doc_id} — no workspace resolvable")
            errors += 1
            turn_errors += len(data.get("turns") or [])
            continue
        # `process_instance_id` FK is notNull — drop the session (and its
        # inline turns) when the referenced run was never migrated.
        if not pi_id or pi_id not in pi_ids:
            print(f"WARN: skipping cowork_sessions doc {doc_id} — orphan process_instance {pi_id!r}")
            errors += 1
            turn_errors += len(data.get("turns") or [])
            continue
        sess_rows.append(
            {
                "id": doc_id,
                "workspace": workspace,
                "process_instance_id": pi_id,
                "step_id": data.get("stepId"),
                "assigned_role": data.get("assignedRole") or "reviewer",
                "assigned_user_id": data.get("assignedUserId"),
                "status": data.get("status") or "active",
                "agent": data.get("agent") or "chat",
                "model": data.get("model"),
                "system_prompt": data.get("systemPrompt"),
                "output_schema": data.get("outputSchema"),
                "voice_config": data.get("voiceConfig"),
                "mcp_servers": data.get("mcpServers"),
                "artifact": data.get("artifact"),
                "finalized_at": data.get("finalizedAt"),
                "created_at": data.get("createdAt"),
                "updated_at": data.get("updatedAt"),
            }
        )
        # Firestore stores `turns` as an array on the session doc.
        for idx, turn in enumerate(data.get("turns") or []):
            turn_rows.append(
                {
                    "id": turn.get("id") or f"{doc_id}-{idx}",
                    "session_id": doc_id,
                    "idx": idx,
                    "role": turn.get("role") or "human",
                    "content": turn.get("content") or "",
                    "artifact_delta": turn.get("artifactDelta"),
                    "timestamp": turn.get("timestamp"),
                    "tool_name": turn.get("toolName"),
                    "tool_args": turn.get("toolArgs"),
                    "tool_result": turn.get("toolResult"),
                    "tool_status": turn.get("toolStatus"),
                    "server_name": turn.get("serverName"),
                }
            )
    ins_s, skip_s = insert_rows(
        pg,
        "cowork_sessions",
        _strip_none_defaults(sess_rows),
        conflict="id",
        dry_run=dry_run,
        # output_schema etc. can be stored as scalar/string jsonb values.
        json_columns={"output_schema", "voice_config", "mcp_servers", "artifact"},
    )
    ins_t, skip_t = insert_rows(
        pg,
        "cowork_turns",
        _strip_none_defaults(turn_rows),
        conflict="id",
        dry_run=dry_run,
        json_columns={"artifact_delta", "tool_args"},
    )
    result = _result(ins_s, skip_s, errors)
    # cowork_turns has its own verify entry (count_only). Surface the turns
    # dropped alongside skipped sessions so the driver logs them.
    result["child_logs"] = {"cowork_turns": _result(ins_t, skip_t, turn_errors)}
    return result


def migrate_namespace_secrets(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """namespaces/{handle}/namespaceSecrets/_config -> rows per key (flattened)."""
    rows: list[dict[str, Any]] = []
    for handle, _ in fs_iter_collection(fs, "namespaces"):
        for doc_id, data in fs_iter_subcollection(fs, "namespaces", handle, "namespaceSecrets"):
            if doc_id != "_config":
                continue
            secrets_map = data.get("secrets") or {}
            for key, encrypted_value in secrets_map.items():
                rows.append(
                    {
                        "workspace": handle,
                        "key": key,
                        "encrypted_value": encrypted_value,
                        "created_at": data.get("createdAt"),
                        "updated_at": data.get("updatedAt"),
                    }
                )
    ins, skip = insert_rows(
        pg,
        "namespace_secrets",
        _strip_none_defaults(rows),
        conflict="workspace, key",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_workflow_secrets(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """namespaces/{handle}/workflowSecrets/{workflowName} -> row per key."""
    rows: list[dict[str, Any]] = []
    for handle, _ in fs_iter_collection(fs, "namespaces"):
        for workflow_name, data in fs_iter_subcollection(
            fs, "namespaces", handle, "workflowSecrets"
        ):
            secrets_map = data.get("secrets") or {}
            for key, encrypted_value in secrets_map.items():
                rows.append(
                    {
                        "workspace": handle,
                        "workflow_name": workflow_name,
                        "key": key,
                        "encrypted_value": encrypted_value,
                        "created_at": data.get("createdAt"),
                        "updated_at": data.get("updatedAt"),
                    }
                )
    ins, skip = insert_rows(
        pg,
        "workflow_secrets",
        _strip_none_defaults(rows),
        conflict="workspace, workflow_name, key",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_tool_catalog(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """namespaces/{handle}/toolCatalog/{entryId} -> tool_catalog_entries."""
    rows: list[dict[str, Any]] = []
    for handle, _ in fs_iter_collection(fs, "namespaces"):
        for entry_id, data in fs_iter_subcollection(fs, "namespaces", handle, "toolCatalog"):
            rows.append(
                {
                    "workspace": handle,
                    "id": entry_id,
                    "command": data.get("command") or "",
                    "args": data.get("args"),
                    "env": data.get("env"),
                    "description": data.get("description"),
                    "created_at": data.get("createdAt"),
                    "updated_at": data.get("updatedAt"),
                }
            )
    ins, skip = insert_rows(
        pg,
        "tool_catalog_entries",
        _strip_none_defaults(rows),
        conflict="workspace, id",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_oauth_providers(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    for handle, _ in fs_iter_collection(fs, "namespaces"):
        for provider_id, data in fs_iter_subcollection(fs, "namespaces", handle, "oauthProviders"):
            rows.append(
                {
                    "workspace": handle,
                    "id": provider_id,
                    "name": data.get("name") or provider_id,
                    "client_id": data.get("clientId") or "",
                    "client_secret": data.get("clientSecret"),
                    "authorize_url": data.get("authorizeUrl") or "",
                    "token_url": data.get("tokenUrl") or "",
                    "revoke_url": data.get("revokeUrl"),
                    "user_info_url": data.get("userInfoUrl"),
                    "scopes": data.get("scopes") or [],
                    "token_endpoint_auth_method": data.get("tokenEndpointAuthMethod"),
                    "issuer": data.get("issuer"),
                    "registration_endpoint": data.get("registrationEndpoint"),
                    "resource_url": data.get("resourceUrl"),
                    "icon_url": data.get("iconUrl"),
                    "created_at": data.get("createdAt"),
                    "updated_at": data.get("updatedAt"),
                }
            )
    ins, skip = insert_rows(
        pg,
        "oauth_providers",
        _strip_none_defaults(rows),
        conflict="workspace, id",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_agent_oauth_tokens(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    for handle, _ in fs_iter_collection(fs, "namespaces"):
        for doc_id, data in fs_iter_subcollection(
            fs, "namespaces", handle, "agentOAuthTokens"
        ):
            # doc id is `${agentId}__${serverName}`; the row carries both
            # explicitly so we don't depend on the composite id format.
            agent_id = data.get("agentId")
            server_name = data.get("serverName")
            if not agent_id or not server_name:
                # Fall back to splitting the composite id.
                parts = doc_id.split("__", 1)
                if len(parts) == 2:
                    agent_id = agent_id or parts[0]
                    server_name = server_name or parts[1]
            rows.append(
                {
                    "workspace": handle,
                    "agent_id": agent_id,
                    "server_name": server_name,
                    "provider_id": data.get("providerId") or "unknown",
                    "access_token": data.get("accessToken") or "",
                    "refresh_token": data.get("refreshToken"),
                    "expires_at": data.get("expiresAt"),
                    "scope": data.get("scope") or "",
                    "provider_user_id": data.get("providerUserId") or "",
                    "account_login": data.get("accountLogin") or "",
                    "connected_at": data.get("connectedAt") or 0,
                    "connected_by": data.get("connectedBy") or "system",
                    "created_at": data.get("createdAt"),
                    "updated_at": data.get("updatedAt"),
                }
            )
    ins, skip = insert_rows(
        pg,
        "agent_oauth_tokens",
        _strip_none_defaults(rows),
        conflict="workspace, agent_id, server_name",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_cron_trigger_state(fs, pg, *, dry_run: bool) -> dict[str, int]:
    rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "cronTriggerState"):
        # Doc id pattern: `${definitionName}:${triggerName}`.
        def_name = data.get("definitionName")
        trigger_name = data.get("triggerName")
        if not def_name or not trigger_name:
            parts = doc_id.split(":", 1)
            if len(parts) == 2:
                def_name = def_name or parts[0]
                trigger_name = trigger_name or parts[1]
        rows.append(
            {
                "definition_name": def_name,
                "trigger_name": trigger_name,
                # notNull-without-default on Postgres — sentinel epoch zero so
                # un-migrated rows are auditable later.
                "last_triggered_at": data.get("lastTriggeredAt")
                or datetime(1970, 1, 1, tzinfo=timezone.utc),
            }
        )
    ins, skip = insert_rows(
        pg,
        "cron_trigger_state",
        _strip_none_defaults(rows),
        conflict="definition_name, trigger_name",
        dry_run=dry_run,
    )
    return _result(ins, skip)


def migrate_user_profiles(fs, pg, *, dry_run: bool) -> dict[str, int]:
    """Migrate Firestore `users/{uid}` docs to the minimal `user_profiles` table.

    Only `must_change_password` is carried over (the doc id is the uid).
    Identity fields (email, displayName, photoURL) live in Firebase Auth;
    handle/roles/organizations live in `namespace_members` — all dead
    duplicates on the `users` doc are dropped (ADR-0001 final cutover, #534).

    Upsert on `uid` so a re-run refreshes the flag (unlike the DO NOTHING
    used elsewhere — this slice is re-run on its own during cutover).
    """
    rows: list[dict[str, Any]] = []
    for doc_id, data in fs_iter_collection(fs, "users"):
        rows.append(
            {
                "uid": doc_id,
                "must_change_password": data.get("mustChangePassword") is True,
            }
        )
    if dry_run:
        LOG.info(
            "[dry-run] %s rows -> user_profiles; first row: %s",
            len(rows),
            rows[0] if rows else None,
        )
        return _result(0, 0)
    inserted = 0
    updated = 0
    with pg.cursor() as cur:
        for row in rows:
            cur.execute(
                'INSERT INTO "user_profiles" ("uid", "must_change_password") '
                "VALUES (%s, %s) "
                "ON CONFLICT (uid) DO UPDATE SET "
                '"must_change_password" = EXCLUDED.must_change_password, '
                '"updated_at" = now()',
                [row["uid"], row["must_change_password"]],
            )
            # rowcount is 1 for both insert and update with this upsert form;
            # distinguish via xmax to report meaningfully is overkill — count
            # every affected row as inserted for the audit log.
            inserted += 1
        pg.commit()
    return _result(inserted, updated)


# ---------- helpers ----------------------------------------------------------


def _bool_to_tombstone(flag: Any, explicit: Any) -> Any:
    """Resolve Firestore's `archived`/`deleted` boolean to a tombstone timestamp.

    The Postgres schema stores `_at` timestamps (NULL = not tombstoned).
    Firestore stored booleans + sometimes an explicit `*At` timestamp.
    Prefer the explicit timestamp when present.
    """
    if explicit:
        return explicit
    if flag:
        return datetime.now(timezone.utc)
    return None


def _strip_none_defaults(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Drop None values so DB defaults (e.g. defaultNow) fire correctly.

    Without this, an explicit NULL would override the column default for
    created_at/updated_at when the Firestore doc had no value.
    """
    cleaned: list[dict[str, Any]] = []
    for row in rows:
        cleaned.append({k: v for k, v in row.items() if v is not None})
    return cleaned


# ---------- driver -----------------------------------------------------------


TABLE_FUNCTIONS: dict[str, Callable] = {
    # Order matters: parents before children (FK constraints).
    "workspaces": migrate_namespaces,
    "agents": migrate_agents,
    "model_registry_entries": migrate_model_registry,
    "workflow_definitions": migrate_workflow_definitions,
    "workflow_meta": migrate_workflow_meta,
    "process_instances": migrate_process_instances,
    "audit_events": migrate_audit_events,
    "agent_runs": migrate_agent_runs,
    "human_tasks": migrate_human_tasks,
    "handoff_entities": migrate_handoff_entities,
    "cowork_sessions": migrate_cowork_sessions,
    "namespace_secrets": migrate_namespace_secrets,
    "workflow_secrets": migrate_workflow_secrets,
    "tool_catalog_entries": migrate_tool_catalog,
    "oauth_providers": migrate_oauth_providers,
    "agent_oauth_tokens": migrate_agent_oauth_tokens,
    "cron_trigger_state": migrate_cron_trigger_state,
    "user_profiles": migrate_user_profiles,
}

CHILD_TABLES_REQUIRING_WS_CACHE = {
    "process_instances",
    "audit_events",
    "agent_runs",
    "human_tasks",
    "handoff_entities",
    "cowork_sessions",
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--firebase-project", required=True)
    p.add_argument("--database-url", required=True)
    p.add_argument("--dry-run", action="store_true")
    p.add_argument(
        "--only",
        help="Comma-separated list of Postgres table names to limit migration to.",
    )
    p.add_argument("--log-file", default="migration_log.json")
    return p.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(cred, {"projectId": args.firebase_project})
    fs = firestore.client()

    pg = psycopg2.connect(args.database_url)
    pg.autocommit = False

    only = set(args.only.split(",")) if args.only else None

    # Workspace cache only needed for child tables.
    ws_cache: dict[str, str] = {}
    needs_cache = (only is None) or bool(only & CHILD_TABLES_REQUIRING_WS_CACHE)
    if needs_cache:
        LOG.info("building workspace cache from processInstances ...")
        ws_cache = build_workspace_cache(fs)

    log: dict[str, dict[str, int]] = {}
    for table, func in TABLE_FUNCTIONS.items():
        if only is not None and table not in only:
            continue
        LOG.info("=== migrating -> %s ===", table)
        try:
            if table in CHILD_TABLES_REQUIRING_WS_CACHE and table != "process_instances":
                result = func(fs, pg, dry_run=args.dry_run, ws_cache=ws_cache)
            elif table == "process_instances":
                result = func(fs, pg, dry_run=args.dry_run, ws_cache=ws_cache)
            else:
                result = func(fs, pg, dry_run=args.dry_run)
        except Exception as exc:  # noqa: BLE001
            LOG.exception("migration of %s failed", table)
            pg.rollback()
            result = {"inserted": 0, "skipped": 0, "errors": 1, "exception": str(exc)}
        # process_instances reports orphan-skipped counts for its child
        # tables (step_executions, agent_events) so verify.py can reconcile
        # them against their own Firestore collection-group counts.
        child_logs = result.pop("child_logs", None)
        log[table] = result
        if child_logs:
            log.update(child_logs)
        LOG.info("%s -> %s", table, result)

    pg.close()
    with open(args.log_file, "w", encoding="utf-8") as fh:
        json.dump(log, fh, indent=2, default=str)
    LOG.info("wrote audit log to %s", args.log_file)
    LOG.info("FINAL SUMMARY: %s", json.dumps(log, indent=2, default=str))

    # Non-zero exit if any table errored.
    return 1 if any(v.get("errors") for v in log.values()) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
