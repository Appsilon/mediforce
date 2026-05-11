#!/usr/bin/env python3
"""
One-shot migration: AgentDefinition.skillFileNames -> agent.skills + Registry blobs.

Phase 4 of the agent-skills refactor (#357) drops `skillFileNames` from
AgentDefinitionSchema. Legacy agents in Firestore still carry the field with
Storage paths like `agentSkills/<agentId>/<filename>`. This script:

  1. Reads every agent in the `agentDefinitions` collection.
  2. For each agent with non-empty `skillFileNames`:
       - Downloads each blob from Firebase Storage at the recorded path.
       - Writes it to `<workspace-dir>/skills/<agentId>/<filename-stem>/SKILL.md`.
       - Plans `agent.skills = [{ registryId, name: '<agentId>/<filename-stem>' }, ...]`.
  3. With `--apply`: writes the new `skills` array and deletes the legacy
     `skillFileNames` field. Without `--apply`: prints the diff per agent.

The operator must, *before* running this script:

  - Create one git repo per environment (e.g. `mediforce/<env>-skills`).
  - Clone it locally — pass that path as `--workspace-dir`.
  - Create the SkillRegistry record via the CLI:
      pnpm exec mediforce skill-registry create \\
          --name "<env> skills" \\
          --repo <repo-url> \\
          --skills-dir skills \\
          --commit <sha>
    pass the returned id as `--registry-id`.

After the script writes blob files into the workspace, the operator commits
and pushes the repo, then updates the SkillRegistry record with the new commit
SHA (separate CLI call).

Vedha's case is *not* handled by this script — her skill already lives in the
mediforce monorepo at `apps/sdtm-rule-migration/plugins/sdtm-rule-migration/
skills`. The operator creates a SkillRegistry pointing at the monorepo +
skillsDir, then hand-edits her agent: `skills = [{ registryId, name:
'sdtmig-reference' }]`, clearing the legacy `skillFileNames`. The script's
generic blob-copy path would re-create those files needlessly.

Usage:

    # Dry run — print planned migrations only
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \\
    python3 scripts/migrate-skill-file-names.py \\
        --project mediforce-staging \\
        --registry-id reg_abc123 \\
        --workspace-dir /tmp/staging-skills

    # Apply
    GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \\
    python3 scripts/migrate-skill-file-names.py \\
        --project mediforce-staging \\
        --registry-id reg_abc123 \\
        --workspace-dir /tmp/staging-skills \\
        --apply
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore, storage
from google.cloud.firestore_v1 import DELETE_FIELD


@dataclass
class Plan:
    agent_id: str
    legacy_paths: list[str]
    new_skills: list[dict[str, str]]
    written_files: list[Path] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)


def build_plan(agent_id: str, legacy_paths: list[str], registry_id: str) -> Plan:
    new_skills: list[dict[str, str]] = []
    for path in legacy_paths:
        stem = Path(path).stem
        if stem == "":
            continue
        new_skills.append({"registryId": registry_id, "name": f"{agent_id}/{stem}"})
    return Plan(agent_id=agent_id, legacy_paths=legacy_paths, new_skills=new_skills)


def write_blob(
    bucket: Any,
    storage_path: str,
    target: Path,
) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    blob = bucket.blob(storage_path)
    blob.download_to_filename(str(target))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Migrate AgentDefinition.skillFileNames to agent.skills + registry blobs",
    )
    parser.add_argument("--project", required=True, help="Firebase / GCP project id")
    parser.add_argument(
        "--registry-id",
        required=True,
        help="Target SkillRegistry id (create via `mediforce skill-registry create` first)",
    )
    parser.add_argument(
        "--workspace-dir",
        required=True,
        type=Path,
        help="Local clone of the Registry git repo. Blobs are written under <dir>/skills/<agentId>/<stem>/SKILL.md",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually rewrite Firestore documents (default: dry run, no writes).",
    )
    return parser.parse_args()


def init_firebase(project: str) -> tuple[Any, Any]:
    cred = credentials.ApplicationDefault()
    firebase_admin.initialize_app(
        cred,
        {
            "projectId": project,
            "storageBucket": f"{project}.appspot.com",
        },
    )
    db = firestore.client()
    bucket = storage.bucket()
    return db, bucket


def main() -> int:
    args = parse_args()

    workspace = args.workspace_dir.resolve()
    skills_root = workspace / "skills"
    if not workspace.exists():
        print(f"ERROR: --workspace-dir does not exist: {workspace}", file=sys.stderr)
        return 1

    db, bucket = init_firebase(args.project)

    plans: list[Plan] = []
    total_files = 0
    total_errors = 0

    for snap in db.collection("agentDefinitions").stream():
        data = snap.to_dict() or {}
        legacy: list[str] = list(data.get("skillFileNames") or [])
        if len(legacy) == 0:
            continue

        plan = build_plan(snap.id, legacy, args.registry_id)
        for storage_path in plan.legacy_paths:
            stem = Path(storage_path).stem
            if stem == "":
                plan.errors.append(f"skipped empty stem for path {storage_path!r}")
                continue
            target = skills_root / snap.id / stem / "SKILL.md"
            try:
                write_blob(bucket, storage_path, target)
                plan.written_files.append(target)
            except Exception as err:
                plan.errors.append(f"download failed for {storage_path!r}: {err}")

        total_files += len(plan.written_files)
        total_errors += len(plan.errors)
        plans.append(plan)

        print(f"\nagent={snap.id}")
        print(f"  legacy skillFileNames: {plan.legacy_paths}")
        print(f"  new agent.skills:      {plan.new_skills}")
        print(f"  wrote {len(plan.written_files)} files under {skills_root / snap.id}/")
        for err in plan.errors:
            print(f"  ERROR: {err}")

    if args.apply:
        print("\n--- applying Firestore writes ---")
        for plan in plans:
            db.collection("agentDefinitions").document(plan.agent_id).update(
                {
                    "skills": plan.new_skills,
                    "skillFileNames": DELETE_FIELD,
                },
            )
            print(f"  wrote agent={plan.agent_id}")
    else:
        print("\n--- dry run: no Firestore writes ---")

    print("\nSummary:")
    print(f"  agents migrated: {len(plans)}")
    print(f"  files written:   {total_files}")
    print(f"  errors:          {total_errors}")
    print()
    print("Next, in the workspace dir:")
    print(f"  cd {workspace}")
    print(f"  git add -A && git commit -m 'migrate skillFileNames blobs from {args.project}' && git push")
    print(
        "Then update the SkillRegistry record's commit SHA so runtime resolves "
        "the new skills:",
    )
    print(
        "  pnpm exec mediforce skill-registry update "
        f"{args.registry_id} --commit <new-sha>",
    )

    return 0


if __name__ == "__main__":
    sys.exit(main())
