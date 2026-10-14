#!/usr/bin/env python3
"""
Move stored workflows off file skills onto catalog Skills (ADR-0028).

Migration 0079 turns every step that named a file skill (`agent.skill` +
`agent.skillsDir`) into an `agent.retiredFileSkill` marker that fails the run,
and drops `external_skills_repo`, the only record of which repo and commit an
external skill was read from. This script puts each such skill into the
workflow's workspace as a catalog Skill and registers a new version whose step
names it in `agent.skills`, with a prompt line that tells the agent to use it
(a catalog Skill is offered, not pasted in, ADR-0025 §5).

Four phases, because the snapshot must be taken before the deploy and the plan
holds decisions a script cannot make (a source for a skill nothing resolves, a
new id for one that collides, a description for a SKILL.md with no frontmatter):

    # 1. BEFORE deploying ADR-0028: record what 0079 will erase. Reads only.
    python3 scripts/migrations/migrate_file_skills_to_catalog.py snapshot \\
        --ssh deploy@204.168.165.57 --ssh-key ~/.ssh/id_ed25519_mediforce \\
        --out /tmp/file-skills/snapshot.json

    # 2. Resolve each file skill to a source and check it. Changes nothing.
    python3 scripts/migrations/migrate_file_skills_to_catalog.py plan \\
        --snapshot /tmp/file-skills/snapshot.json --out /tmp/file-skills/plan.json \\
        --workspace appsilon --workspace mediforce --workspace user-session-8oct

    # 3. Edit plan.json where an entry is blocked: set `source`, change
    #    `catalogId`, or fill `description`. Re-run `plan` is not needed.

    # 4. Rehearse (reads only), then apply once the deploy is live.
    MEDIFORCE_BASE_URL=https://staging.mediforce.ai MEDIFORCE_API_KEY=... \\
        python3 scripts/migrations/migrate_file_skills_to_catalog.py apply \\
        --plan /tmp/file-skills/plan.json --out-dir /tmp/file-skills/out --dry-run

A file skill resolves the way the runtime read it: from the files the workflow
carries, else from its `externalSkillsRepo` at the pinned commit, else from the
platform checkout, where `apps/<app>/plugins/<app>/skills/<name>` now lives at
`apps/<app>/skills/<name>`. The version migrated is the workflow's default
version when one is set (it is what unpinned runs and triggers execute), else
its latest; a set default is moved to the new version.

Re-runnable: a Skill already in the catalog with the same files is reused, a
step that already names its Skill gets no second prompt line, and a workflow
that fails is reported without stopping the others.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SKILL_MAX_TOTAL_BYTES = 1024 * 1024
SKILL_NAME_PATTERN = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
PROMPT_LINE = "Use the `{id}` skill: it holds this step's instructions. Load it first and follow it."
GIT_ENV = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}

SNAPSHOT_SQL = r"""
WITH heads AS (
  SELECT d.workspace, d.name, max(d.version) AS latest, m.default_version
  FROM workflow_definitions d
  LEFT JOIN workflow_meta m ON m.workspace = d.workspace AND m.name = d.name
  WHERE d.deleted_at IS NULL AND d.archived_at IS NULL
  GROUP BY d.workspace, d.name, m.default_version
),
affected AS (
  SELECT h.workspace, h.name, h.latest, h.default_version,
         COALESCE(h.default_version, h.latest) AS base_version,
         d.steps, d.external_skills_repo, d.artifacts
  FROM heads h
  JOIN workflow_definitions d
    ON d.workspace = h.workspace AND d.name = h.name AND d.version = COALESCE(h.default_version, h.latest)
  WHERE EXISTS (
    SELECT 1 FROM jsonb_array_elements(d.steps) s
    WHERE s->'agent' ? 'skill' OR s->'agent' ? 'skillsDir'
  )
)
SELECT json_build_object(
  'takenAt', now(),
  'workflows', COALESCE((SELECT json_agg(json_build_object(
    'workspace', a.workspace,
    'name', a.name,
    'latestVersion', a.latest,
    'defaultVersion', a.default_version,
    'baseVersion', a.base_version,
    'externalSkillsRepo', a.external_skills_repo,
    'steps', (
      SELECT json_agg(json_build_object(
        'id', s->>'id', 'skill', s->'agent'->>'skill', 'skillsDir', s->'agent'->>'skillsDir'))
      FROM jsonb_array_elements(a.steps) s
      WHERE s->'agent' ? 'skill' OR s->'agent' ? 'skillsDir'
    ),
    'artifacts', COALESCE(a.artifacts, '[]'::jsonb),
    'activeRuns', (
      SELECT json_build_object(
        'running', count(*) FILTER (WHERE p.status = 'running'),
        'paused', count(*) FILTER (WHERE p.status = 'paused'))
      FROM process_instances p
      JOIN workflow_definitions v
        ON v.workspace = p.workspace AND v.name = p.definition_name AND v.version::text = p.definition_version
      WHERE p.workspace = a.workspace AND p.definition_name = a.name AND p.deleted_at IS NULL
        AND p.status IN ('running', 'paused')
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(v.steps) s
          WHERE COALESCE(s->'agent'->>'skillsDir', '') <> ''
        )
    )
  ) ORDER BY a.workspace, a.name) FROM affected a), '[]'::json),
  'catalog', COALESCE((
    SELECT json_agg(json_build_object('workspace', k.workspace, 'id', k.id, 'files', k.files))
    FROM skills k
  ), '[]'::json)
);
"""


class MigrationError(Exception):
    pass


def run(command: list[str], *, cwd: Path | None = None, input_text: str | None = None) -> str:
    result = subprocess.run(command, cwd=cwd, input=input_text, capture_output=True, text=True, env=GIT_ENV)
    if result.returncode != 0:
        raise MigrationError(f"{' '.join(command[:4])} failed: {result.stderr.strip() or result.stdout.strip()}")
    return result.stdout


def run_bytes(command: list[str], *, cwd: Path | None = None) -> bytes:
    result = subprocess.run(command, cwd=cwd, capture_output=True, env=GIT_ENV)
    if result.returncode != 0:
        raise MigrationError(f"{' '.join(command[:4])} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def normalize_repo_path(path: str) -> str:
    segments: list[str] = []
    for segment in path.split("/"):
        if segment in ("", "."):
            continue
        if segment == "..":
            if len(segments) == 0:
                raise MigrationError(f"path escapes the repo: {path}")
            segments.pop()
        else:
            segments.append(segment)
    return "/".join(segments)


# --- snapshot -----------------------------------------------------------------


def snapshot_command(args: argparse.Namespace) -> int:
    ssh = ["ssh", "-o", "ConnectTimeout=15"]
    if args.ssh_key is not None:
        ssh += ["-i", os.path.expanduser(args.ssh_key)]
    psql = f"docker exec -i {args.postgres_container} psql -U mediforce -d mediforce -At -q -v ON_ERROR_STOP=1"
    raw = run([*ssh, args.ssh, psql], input_text=SNAPSHOT_SQL)
    snapshot = json.loads(raw)
    snapshot["deployedCommit"] = run([*ssh, args.ssh, f"git -C {args.deploy_dir} rev-parse HEAD"]).strip()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snapshot, indent=2) + "\n")
    step_count = sum(len(workflow["steps"]) for workflow in snapshot["workflows"])
    print(f"Snapshot of {len(snapshot['workflows'])} workflow(s), {step_count} file-skill step(s) -> {out}")
    return 0


# --- sources ------------------------------------------------------------------


def platform_skill_paths(ref: str) -> set[str]:
    """Folders under `ref` holding a SKILL.md that is a plain file."""
    listing = run(["git", "ls-tree", "-r", "--full-tree", ref], cwd=REPO_ROOT)
    folders: set[str] = set()
    for line in listing.splitlines():
        meta, path = line.split("\t", 1)
        if meta.split()[0] != "120000" and path.endswith("/SKILL.md"):
            folders.add(path[: -len("/SKILL.md")])
    return folders


def find_in_platform(folder: str, skill_folders: set[str]) -> str | None:
    name = posixpath.basename(folder)
    candidates = [folder]
    moved = re.match(r"^apps/([^/]+)/plugins/[^/]+/skills/([^/]+)$", folder)
    if moved is not None:
        candidates.append(f"apps/{moved.group(1)}/skills/{moved.group(2)}")
    for candidate in candidates:
        if candidate in skill_folders:
            return candidate
    in_apps = sorted(path for path in skill_folders if re.match(rf"^apps/[^/]+/skills/{re.escape(name)}$", path))
    return in_apps[0] if len(in_apps) == 1 else None


def resolve_source(workflow: dict, folder: str, platform_ref: str, skill_folders: set[str]) -> dict:
    artifact_paths = {artifact["path"] for artifact in workflow["artifacts"]}
    if f"{folder}/SKILL.md" in artifact_paths:
        return {"kind": "artifacts", "workflow": workflow["name"], "version": workflow["baseVersion"], "path": folder}
    external = workflow.get("externalSkillsRepo") or {}
    if external.get("url") and external.get("commit"):
        return {"kind": "repo", "url": external["url"], "ref": external["commit"], "path": folder}
    in_platform = find_in_platform(folder, skill_folders)
    if in_platform is not None:
        return {"kind": "platform", "ref": platform_ref, "path": in_platform}
    return {"kind": "unresolved", "path": folder}


def source_label(source: dict) -> str:
    if source["kind"] == "repo":
        return f"repo:{source['url']}@{source['ref'][:12]}:{source['path']}"
    if source["kind"] == "artifacts":
        return f"artifacts:{source['workflow']}@v{source['version']}:{source['path']}"
    if source["kind"] == "platform":
        return f"platform@{source['ref'][:12]}:{source['path']}"
    return f"unresolved:{source['path']}"


def github_slug(url: str) -> str:
    match = re.match(r"^https://github\.com/([^/]+)/([^/#?]+?)(?:\.git)?/?$", url)
    if match is None:
        raise MigrationError(f"not a GitHub repo URL: {url}")
    return f"{match.group(1)}/{match.group(2)}"


def repo_archive(url: str, ref: str, path: str, cache: Path) -> bytes:
    slug = github_slug(url)
    clone = cache / "repos" / slug.replace("/", "__")
    if not clone.exists():
        clone.parent.mkdir(parents=True, exist_ok=True)
        run(["git", "clone", "--bare", "--filter=blob:none", "--quiet", f"https://github.com/{slug}.git", str(clone)])
    try:
        run(["git", "cat-file", "-e", f"{ref}^{{commit}}"], cwd=clone)
    except MigrationError:
        run(["git", "fetch", "--quiet", "origin", ref], cwd=clone)
    return run_bytes(["git", "archive", "--format=tar", ref, "--", path], cwd=clone)


def files_from_tar(archive: bytes, prefix: str) -> dict[str, bytes]:
    files: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        for member in tar.getmembers():
            if not member.name.startswith(prefix + "/"):
                continue
            relative = member.name[len(prefix) + 1:]
            if any(segment.startswith(".") for segment in relative.split("/")):
                continue
            if member.issym() or member.islnk():
                raise MigrationError(f"{member.name} is a link; a Skill holds plain files only")
            if member.isfile():
                extracted = tar.extractfile(member)
                if extracted is None:
                    raise MigrationError(f"cannot read {member.name}")
                files[relative] = extracted.read()
    return files


def materialize(source: dict, snapshot: dict, workspace: str, cache: Path) -> dict[str, bytes]:
    kind = source["kind"]
    if kind == "artifacts":
        workflow = next(
            (item for item in snapshot["workflows"] if item["workspace"] == workspace and item["name"] == source["workflow"]),
            None,
        )
        if workflow is None:
            raise MigrationError(f"workflow {source['workflow']} is not in the snapshot")
        prefix = source["path"] + "/"
        return {
            artifact["path"][len(prefix):]: artifact["contents"].encode()
            for artifact in workflow["artifacts"]
            if artifact["path"].startswith(prefix)
            and not any(segment.startswith(".") for segment in artifact["path"][len(prefix):].split("/"))
        }
    if kind == "repo":
        return files_from_tar(repo_archive(source["url"], source["ref"], source["path"], cache), source["path"])
    if kind == "platform":
        archive = run_bytes(["git", "archive", "--format=tar", source["ref"], "--", source["path"]], cwd=REPO_ROOT)
        return files_from_tar(archive, source["path"])
    raise MigrationError(f"no source for {source['path']}: set `source` in the plan")


# --- skill checks -------------------------------------------------------------


def parse_frontmatter(skill_md: str) -> dict[str, str] | None:
    match = re.match(r"^---\r?\n(.*?)\r?\n---\r?\n", skill_md, re.DOTALL)
    if match is None:
        return None
    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        field = re.match(r"^(name|description):\s*(.*)$", line)
        if field is not None:
            fields[field.group(1)] = field.group(2).strip().strip("'\"")
    return fields


def final_files(entry: dict, raw: dict[str, bytes]) -> dict[str, str]:
    """The files the Skill is created from: text, with its frontmatter naming `catalogId`."""
    files: dict[str, str] = {}
    for path, contents in raw.items():
        try:
            text = contents.decode("utf-8")
        except UnicodeDecodeError as error:
            raise MigrationError(f"{path} is not UTF-8 text") from error
        if "\x00" in text:
            raise MigrationError(f"{path} contains a NUL character")
        files[path] = text
    if "SKILL.md" not in files:
        raise MigrationError("no SKILL.md in the folder")
    skill_md = files["SKILL.md"]
    frontmatter = parse_frontmatter(skill_md)
    if frontmatter is None or not frontmatter.get("description"):
        description = entry.get("description")
        if not description:
            raise MigrationError("SKILL.md has no frontmatter description: fill `description` in the plan")
        body = skill_md if frontmatter is None else re.sub(r"^---\r?\n.*?\r?\n---\r?\n", "", skill_md, count=1, flags=re.DOTALL)
        skill_md = f"---\nname: {entry['catalogId']}\ndescription: {json.dumps(description)}\n---\n\n{body.lstrip()}"
    elif frontmatter.get("name") != entry["catalogId"]:
        skill_md = re.sub(r"(?m)^name:.*$", f"name: {entry['catalogId']}", skill_md, count=1)
    files["SKILL.md"] = skill_md
    if SKILL_NAME_PATTERN.match(entry["catalogId"]) is None:
        raise MigrationError(f"catalogId '{entry['catalogId']}' is not kebab-case")
    size = sum(len(path.encode()) + len(contents.encode()) for path, contents in files.items())
    if size > SKILL_MAX_TOTAL_BYTES:
        raise MigrationError(f"{size} bytes is over the {SKILL_MAX_TOTAL_BYTES}-byte Skill cap")
    return files


def content_hash(files: dict[str, str]) -> str:
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(path.encode() + b"\0" + files[path].encode() + b"\0")
    return digest.hexdigest()


def check_skills(entries: list[dict], snapshot: dict, cache: Path, existing: dict[tuple[str, str], str]) -> dict[str, dict[str, str]]:
    """Fill `status` / `issue` / `bytes` on every entry; return the final files of each usable one."""
    built: dict[str, dict[str, str]] = {}
    for entry in entries:
        entry.pop("issue", None)
        try:
            files = final_files(entry, materialize(entry["source"], snapshot, entry["workspace"], cache))
        except MigrationError as error:
            entry["status"], entry["issue"] = "blocked", str(error)
            continue
        built[entry["key"]] = files
        entry["bytes"] = sum(len(contents.encode()) for contents in files.values())
        entry["status"] = "ready"
    hashes: dict[tuple[str, str], set[str]] = {}
    for entry in entries:
        if entry["key"] in built:
            hashes.setdefault((entry["workspace"], entry["catalogId"]), set()).add(content_hash(built[entry["key"]]))
    for entry in entries:
        if entry["key"] not in built:
            continue
        slot = (entry["workspace"], entry["catalogId"])
        mine = content_hash(built[entry["key"]])
        if len(hashes[slot]) > 1:
            entry["status"], entry["issue"] = "blocked", f"another source also makes '{entry['catalogId']}' with other files: change `catalogId` on one"
            del built[entry["key"]]
        elif slot in existing and existing[slot] != mine:
            entry["status"], entry["issue"] = "blocked", f"the catalog already has a different '{entry['catalogId']}': change `catalogId`"
            del built[entry["key"]]
        elif slot in existing:
            entry["status"] = "exists"
    return built


# --- plan ---------------------------------------------------------------------


def plan_command(args: argparse.Namespace) -> int:
    snapshot_path = Path(args.snapshot).resolve()
    snapshot = json.loads(snapshot_path.read_text())
    cache = Path(args.cache) if args.cache is not None else Path(args.out).parent / "cache"
    platform_ref = run(["git", "rev-parse", args.platform_ref], cwd=REPO_ROOT).strip()
    skill_folders = platform_skill_paths(platform_ref)
    workspaces = set(args.workspace)
    skills: dict[str, dict] = {}
    workflows: list[dict] = []
    for workflow in snapshot["workflows"]:
        if len(workspaces) > 0 and workflow["workspace"] not in workspaces:
            continue
        steps = []
        for step in workflow["steps"]:
            skills_dir = (step.get("skillsDir") or "").strip()
            if skills_dir == "":
                continue  # a skill with no skillsDir never ran; 0079 just drops it
            folder = normalize_repo_path(skills_dir)
            if step.get("skill"):
                folder = posixpath.join(folder, step["skill"])
            source = resolve_source(workflow, folder, platform_ref, skill_folders)
            key = f"{workflow['workspace']}/{source_label(source)}"
            entry = skills.setdefault(key, {
                "key": key,
                "workspace": workflow["workspace"],
                "catalogId": posixpath.basename(folder),
                "source": source,
                "usedBy": [],
            })
            entry["usedBy"].append(f"{workflow['name']}#{step['id']}")
            steps.append({"id": step["id"], "skillKey": key})
        if len(steps) == 0:
            continue
        workflows.append({
            "workspace": workflow["workspace"],
            "name": workflow["name"],
            "baseVersion": workflow["baseVersion"],
            "latestVersion": workflow["latestVersion"],
            "defaultVersion": workflow["defaultVersion"],
            "activeRuns": workflow["activeRuns"],
            "steps": steps,
        })
    for entry in skills.values():
        if entry["source"]["kind"] in ("repo", "platform", "artifacts"):
            try:
                raw = materialize(entry["source"], snapshot, entry["workspace"], cache)
                frontmatter = parse_frontmatter(raw.get("SKILL.md", b"").decode("utf-8", errors="replace")) or {}
                if frontmatter.get("name"):
                    entry["catalogId"] = frontmatter["name"]
            except MigrationError:
                pass  # check_skills reports it
    existing = {
        (skill["workspace"], skill["id"]): content_hash({file["path"]: file["contents"] for file in skill["files"]})
        for skill in snapshot["catalog"]
    }
    check_skills(list(skills.values()), snapshot, cache, existing)
    plan = {"snapshot": str(snapshot_path), "cache": str(cache.resolve()), "skills": list(skills.values()), "workflows": workflows}
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(plan, indent=2) + "\n")
    print_plan(plan)
    print(f"\nPlan -> {out}")
    return 0


def print_plan(plan: dict) -> None:
    by_key = {entry["key"]: entry for entry in plan["skills"]}
    print("Skills:")
    for entry in sorted(plan["skills"], key=lambda item: (item["workspace"], item["catalogId"])):
        detail = entry.get("issue") or f"{entry.get('bytes', 0)} bytes"
        print(f"  [{entry['status']:7}] {entry['workspace']}/{entry['catalogId']}  <- {source_label(entry['source'])}  ({detail})")
    print("\nWorkflows:")
    for workflow in plan["workflows"]:
        blocked = sorted({by_key[step["skillKey"]]["catalogId"] for step in workflow["steps"] if by_key[step["skillKey"]]["status"] == "blocked"})
        default = "" if workflow["defaultVersion"] is None else f", default v{workflow['defaultVersion']}"
        runs = workflow["activeRuns"]
        active = f", {runs['running']} running / {runs['paused']} paused on file-skill versions" if runs["running"] + runs["paused"] > 0 else ""
        state = f"BLOCKED by {', '.join(blocked)}" if len(blocked) > 0 else "ready"
        print(f"  {workflow['workspace']}/{workflow['name']} v{workflow['baseVersion']} (latest v{workflow['latestVersion']}{default}{active}): "
              f"{len(workflow['steps'])} step(s), {state}")


# --- apply --------------------------------------------------------------------


def mediforce(*arguments: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["pnpm", "--silent", "exec", "mediforce", *arguments], cwd=REPO_ROOT, capture_output=True, text=True)


def mediforce_json(*arguments: str) -> dict:
    result = mediforce(*arguments, "--json")
    if result.returncode != 0:
        raise MigrationError(f"mediforce {' '.join(arguments[:2])}: {result.stderr.strip() or result.stdout.strip()}")
    return json.loads(result.stdout)


def live_catalog_hash(workspace: str, skill_id: str) -> str | None:
    result = mediforce("skill", "get", skill_id, "--namespace", workspace, "--json")
    if result.returncode != 0:
        if re.search(r"not found", result.stderr + result.stdout, re.IGNORECASE):
            return None
        raise MigrationError(f"mediforce skill get {skill_id}: {result.stderr.strip() or result.stdout.strip()}")
    skill = json.loads(result.stdout)
    skill = skill.get("skill", skill)
    return content_hash({file["path"]: file["contents"] for file in skill["files"]})


def with_build_repo(config: dict, external: dict, artifact_paths: set[str]) -> None:
    """What 0079 writes onto a step that built through `externalSkillsRepo`."""
    if not external.get("url") or not external.get("commit"):
        return
    dockerfile = config.get("dockerfile") or None
    names_repo = bool(config.get("repo")) and bool(config.get("commit"))
    if dockerfile is not None and not names_repo and normalize_repo_path(dockerfile) not in artifact_paths:
        config["repo"] = config.get("repo") or external["url"]
        config["commit"] = config.get("commit") or external["commit"]
    if config.get("repo") and "repoAuth" not in config and external.get("auth"):
        config["repoAuth"] = external["auth"]


def rewrite_definition(definition: dict, workflow: dict, by_key: dict[str, dict]) -> list[str]:
    targets = {step["id"]: by_key[step["skillKey"]]["catalogId"] for step in workflow["steps"]}
    external = definition.pop("externalSkillsRepo", None) or {}
    definition.pop("legacyDefinition", None)
    artifact_paths = {artifact["path"] for artifact in definition.get("artifacts") or []}
    changes = []
    for step in definition["steps"]:
        agent = step.get("agent")
        if isinstance(agent, dict):
            had_file_skill = bool((agent.get("skillsDir") or "").strip()) or bool(agent.get("retiredFileSkill"))
            for field in ("skill", "skillsDir", "retiredFileSkill"):
                agent.pop(field, None)
            if step["id"] in targets:
                skill_id = targets[step["id"]]
                refs = agent.setdefault("skills", [])
                if not any(ref["namespace"] == workflow["workspace"] and ref["id"] == skill_id for ref in refs):
                    refs.append({"namespace": workflow["workspace"], "id": skill_id})
                line = PROMPT_LINE.format(id=skill_id)
                prompt = agent.get("prompt") or ""
                if line not in prompt:
                    agent["prompt"] = line if prompt.strip() == "" else f"{line}\n\n{prompt}"
                changes.append(f"{step['id']} -> {workflow['workspace']}/{skill_id}")
            elif had_file_skill:
                raise MigrationError(f"step {step['id']} has a file skill the plan does not cover; re-take the snapshot")
        for kind in ("agent", "script"):
            if isinstance(step.get(kind), dict):
                with_build_repo(step[kind], external, artifact_paths)
    return changes


def is_migrated(definition: dict, workflow: dict, by_key: dict[str, dict]) -> bool:
    """True when a version after the base already names every planned Skill and keeps no marker."""
    if definition["version"] <= workflow["baseVersion"]:
        return False
    steps = {step["id"]: step.get("agent") or {} for step in definition["steps"]}
    for planned in workflow["steps"]:
        agent = steps.get(planned["id"], {})
        ref = {"namespace": workflow["workspace"], "id": by_key[planned["skillKey"]]["catalogId"]}
        if agent.get("retiredFileSkill") or ref not in (agent.get("skills") or []):
            return False
    return True


def validate_locally(files: list[Path]) -> dict[str, list[str]]:
    """Parse with this checkout's schema, which is the one the deploy brings."""
    if len(files) == 0:
        return {}
    script = (
        "import('./packages/platform-core/src/schemas/workflow-definition.ts').then((schema) => {"
        " const fs = require('fs');"
        " for (const file of process.argv.slice(1)) {"
        "  const result = schema.parseWorkflowDefinitionForCreation(JSON.parse(fs.readFileSync(file, 'utf8')));"
        "  console.log(JSON.stringify({ file, errors: result.success ? [] :"
        "   result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }));"
        " } })"
    )
    output = run([str(REPO_ROOT / "node_modules/.bin/tsx"), "-e", script, *map(str, files)], cwd=REPO_ROOT)
    return {line["file"]: line["errors"] for line in map(json.loads, output.splitlines())}


def apply_command(args: argparse.Namespace) -> int:
    plan = json.loads(Path(args.plan).read_text())
    snapshot = json.loads(Path(plan["snapshot"]).read_text())
    out_dir = Path(args.out_dir)
    cache = Path(plan["cache"])
    entries = plan["skills"]
    by_key = {entry["key"]: entry for entry in entries}

    existing: dict[tuple[str, str], str] = {}
    for entry in entries:
        found = live_catalog_hash(entry["workspace"], entry["catalogId"])
        if found is not None:
            existing[(entry["workspace"], entry["catalogId"])] = found
    built = check_skills(entries, snapshot, cache, existing)

    prepared: list[tuple[dict, Path, list[str]]] = []
    failures: list[str] = []
    for workflow in plan["workflows"]:
        label = f"{workflow['workspace']}/{workflow['name']}"
        blocked = [by_key[step["skillKey"]] for step in workflow["steps"] if by_key[step["skillKey"]]["status"] == "blocked"]
        if len(blocked) > 0:
            failures.append(f"{label}: skipped, blocked skill(s): " + "; ".join(f"{entry['catalogId']} ({entry['issue']})" for entry in blocked))
            continue
        target = out_dir / "workflows" / workflow["workspace"] / f"{workflow['name']}.wd.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            latest = mediforce_json("workflow", "get", workflow["name"], "--namespace", workflow["workspace"])
            if is_migrated(latest, workflow, by_key):
                print(f"{label}: already migrated (v{latest['version']}), skipped")
                continue
            definition = mediforce_json("workflow", "get", workflow["name"], "--namespace", workflow["workspace"],
                                        "--version", str(workflow["baseVersion"]), "--template")
            changes = rewrite_definition(definition, workflow, by_key)
        except MigrationError as error:
            failures.append(f"{label}: {error}")
            continue
        target.write_text(json.dumps({**definition, "namespace": workflow["workspace"]}, indent=2) + "\n")
        prepared.append((workflow, target, changes))

    errors = validate_locally([target for _, target, _ in prepared])
    created: set[tuple[str, str]] = set()
    migrated = 0
    for workflow, target, changes in prepared:
        label = f"{workflow['workspace']}/{workflow['name']}"
        if len(errors.get(str(target), [])) > 0:
            failures.append(f"{label}: invalid after rewrite: " + "; ".join(errors[str(target)]))
            continue
        print(f"{label} v{workflow['baseVersion']} -> {target}")
        for change in changes:
            print(f"    {change}")
        try:
            for step in workflow["steps"]:
                entry = by_key[step["skillKey"]]
                slot = (entry["workspace"], entry["catalogId"])
                if entry["status"] == "exists" or slot in created:
                    continue
                folder = out_dir / "skills" / entry["workspace"] / entry["catalogId"]
                shutil.rmtree(folder, ignore_errors=True)
                for path, contents in built[entry["key"]].items():
                    (folder / path).parent.mkdir(parents=True, exist_ok=True)
                    (folder / path).write_text(contents)
                print(f"    create Skill {entry['workspace']}/{entry['catalogId']} from {source_label(entry['source'])}")
                if not args.dry_run:
                    mediforce_json("skill", "create", "--from", str(folder), "--namespace", entry["workspace"])
                created.add(slot)
            if args.dry_run:
                migrated += 1
                continue
            registered = mediforce_json("workflow", "register", "--file", str(target), "--namespace", workflow["workspace"])
            print(f"    registered v{registered['version']}")
            if workflow["defaultVersion"] is not None:
                mediforce_json("workflow", "set-default-version", workflow["name"], "--namespace", workflow["workspace"],
                               "--version", str(registered["version"]))
                print(f"    default moved v{workflow['defaultVersion']} -> v{registered['version']}")
            migrated += 1
        except MigrationError as error:
            failures.append(f"{label}: {error}")

    if len(failures) > 0:
        print("\nNot migrated:", file=sys.stderr)
        for failure in failures:
            print(f"  {failure}", file=sys.stderr)
    verb = "would be migrated" if args.dry_run else "migrated"
    print(f"\n{migrated} workflow(s) {verb}, {len(failures)} not.")
    return 0 if len(failures) == 0 else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)

    snapshot = commands.add_parser("snapshot", help="Record file-skill steps before migration 0079 erases their source")
    snapshot.add_argument("--ssh", required=True, help="user@host of the deployment")
    snapshot.add_argument("--ssh-key", help="SSH identity file")
    snapshot.add_argument("--postgres-container", default="mediforce-postgres-1")
    snapshot.add_argument("--deploy-dir", default="/opt/mediforce")
    snapshot.add_argument("--out", required=True)
    snapshot.set_defaults(handler=snapshot_command)

    plan = commands.add_parser("plan", help="Resolve and check every file skill; writes an editable plan")
    plan.add_argument("--snapshot", required=True)
    plan.add_argument("--out", required=True)
    plan.add_argument("--workspace", action="append", default=[], help="Limit to a workspace (repeatable; default: all)")
    plan.add_argument("--platform-ref", default="HEAD", help="Platform commit whose apps/ skills are imported (default: HEAD)")
    plan.add_argument("--cache", help="Where external repos are cloned (default: cache/ beside --out)")
    plan.set_defaults(handler=plan_command)

    apply = commands.add_parser("apply", help="Create the Skills and register the rewritten workflows")
    apply.add_argument("--plan", required=True)
    apply.add_argument("--out-dir", required=True, help="Where rewritten definitions and skill folders are written")
    apply.add_argument("--dry-run", action="store_true", help="Read and rewrite only; create and register nothing")
    apply.set_defaults(handler=apply_command)

    args = parser.parse_args()
    try:
        return args.handler(args)
    except MigrationError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
