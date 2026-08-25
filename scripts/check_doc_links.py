#!/usr/bin/env python3
"""Fail the build when documentation metadata or references are invalid.

Every active Markdown file under `docs/` must declare valid status, audience,
and last-reviewed metadata, and be reachable by Markdown links from
`docs/README.md`. Two classes of reference are also checked:

1. Markdown links and images — `[text](target)` / `![alt](target)` — with a
   relative target, resolved against the linking file's directory.
2. Backticked repo paths ending in `.md` under `docs/` or `skills/`, resolved
   against the repo root. Skills reference docs this way rather than as links,
   and those references rot exactly like links do.

External URLs, `mailto:`, pure `#anchor` targets, fenced code blocks, and
placeholder paths (`<name>`, globs) are out of scope; anchors and query strings
are stripped before the existence check.

Under `website/` a link target is resolved the way Docusaurus resolves it: the
extension is optional, and a directory means its `index.md`. `[Verify](../run/verify)`
is a live link there and a broken one anywhere else, because GitHub — which
renders every other Markdown file in this repo — does not fill in the extension.

A document declaring `status: historical` (or, for an ADR, `status: superseded`)
in its frontmatter is skipped entirely: it records a past state of the repo, so
its references are expected to point at files that have since been deleted.
`CHANGELOG.md` is skipped for the same reason, as is everything under
`docs/archive/` — that directory is historical by definition, so an archived
document does not have to declare it per-file to be exempt.
"""

import re
import sys
from datetime import date
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SKIP_DIRS = {".git", "node_modules", ".next", "dist", "build", ".turbo", "coverage"}

# Docusaurus resolves an extensionless target and a directory to a page; every
# other Markdown file in the repo is read on GitHub, which does not.
DOCUSAURUS_ROOT = "website/"
DOCUSAURUS_SUFFIXES = (".md", ".mdx", "/index.md", "/index.mdx")

# Records of a past repo state — their references are meant to be frozen, not live.
SKIP_FILES = {"CHANGELOG.md"}
SKIP_PREFIXES = ("docs/archive/",)

FENCE_RE = re.compile(r"^\s*(```|~~~)")
FRONTMATTER_STATUS_RE = re.compile(r"^status:\s*(.+?)\s*$", re.MULTILINE)
FRONTMATTER_FIELD_RE = re.compile(r"^([a-z_]+):\s*(.+?)\s*$", re.MULTILINE)

LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
BACKTICK_PATH_RE = re.compile(r"`((?:docs|skills)/[^`\s]+\.md)`")

ROOT_ANCHORED_PREFIXES = ("docs/", "skills/")

# Artifacts a skill writes rather than reads — absent from a clean checkout.
GENERATED_PATHS = {"docs/pitch/deck.md"}

DOC_STATUSES = {"living", "draft", "historical"}
ADR_STATUS_RE = re.compile(
    r"^(?:proposed|accepted|finalized|deprecated|(?:partially )?superseded by \d{4})$"
)
AUDIENCES = {"everyone", "engineers", "workflow-authors", "operators", "agents"}


def is_build_output(rel: Path) -> bool:
    """`build`, `dist` and friends name generated directories — but `build` is
    also a legitimate docs section (`website/docs/build/`), so the name only
    counts until the first `docs/` segment."""
    parts = rel.parts
    return any(
        part in SKIP_DIRS and "docs" not in parts[:index]
        for index, part in enumerate(parts)
    )


def markdown_files() -> list[Path]:
    files = []
    for path in REPO_ROOT.rglob("*.md"):
        if is_build_output(path.relative_to(REPO_ROOT)):
            continue
        files.append(path)
    return sorted(files)


def is_external(target: str) -> bool:
    return "://" in target or target.startswith(("mailto:", "tel:", "#"))


def is_placeholder(target: str) -> bool:
    """`<name>`, `docs/*.md`, `${VAR}` — patterns, not paths."""
    if any(ch in target for ch in "<>*${}"):
        return True
    return "/" not in target and "." not in target


def is_historical(text: str) -> bool:
    if not text.startswith("---"):
        return False
    end = text.find("\n---", 3)
    if end == -1:
        return False
    match = FRONTMATTER_STATUS_RE.search(text[3:end])
    return match is not None and (
        match.group(1) == "historical"
        or match.group(1) == "deprecated"
        or match.group(1).startswith("superseded by ")
    )


def check_metadata(path: Path, text: str) -> list[str]:
    rel = path.relative_to(REPO_ROOT)
    rel_posix = rel.as_posix()
    is_context = rel_posix == "CONTEXT.md"
    if (not rel_posix.startswith("docs/") and not is_context) or rel_posix.startswith(
        SKIP_PREFIXES
    ):
        return []

    if not text.startswith("---\n"):
        return [f"{rel}:1: missing frontmatter"]

    end = text.find("\n---", 4)
    if end == -1:
        return [f"{rel}:1: unclosed frontmatter"]

    fields = dict(FRONTMATTER_FIELD_RE.findall(text[4:end]))
    problems = []
    for field in ("status", "audience", "last_reviewed"):
        if field not in fields:
            problems.append(f"{rel}:1: missing frontmatter field -> {field}")

    status = fields.get("status")
    is_adr = rel.parent == Path("docs/adr") and rel.name != "README.md"
    valid_status = (
        ADR_STATUS_RE.fullmatch(status) is not None
        if is_adr and status is not None
        else status in DOC_STATUSES
    )
    if status is not None and valid_status is not True:
        problems.append(f"{rel}:1: invalid status -> {status}")

    audience = fields.get("audience")
    if audience is not None and audience not in AUDIENCES:
        problems.append(f"{rel}:1: invalid audience -> {audience}")

    reviewed = fields.get("last_reviewed")
    if reviewed is not None:
        try:
            date.fromisoformat(reviewed)
        except ValueError:
            problems.append(f"{rel}:1: invalid last_reviewed date -> {reviewed}")

    return problems


def strip_fragment(target: str) -> str:
    return target.split("#", 1)[0].split("?", 1)[0]


def markdown_targets(path: Path, text: str) -> set[Path]:
    targets = set()
    in_fence = False
    for line in text.splitlines():
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue
        for target in LINK_RE.findall(line):
            if is_external(target) or is_placeholder(target):
                continue
            cleaned = strip_fragment(target)
            if cleaned == "":
                continue
            base = REPO_ROOT if cleaned.startswith("/") else path.parent
            resolved = (base / cleaned.lstrip("/")).resolve()
            if not resolved.is_relative_to(REPO_ROOT):
                continue
            if resolved.is_dir() and (resolved / "README.md").is_file():
                resolved = resolved / "README.md"
            if resolved.is_file() and resolved.suffix == ".md":
                targets.add(resolved)
    return targets


def check_routing() -> list[str]:
    start = REPO_ROOT / "docs/README.md"
    reachable = set()
    pending = [start]
    while pending:
        path = pending.pop()
        if path in reachable:
            continue
        reachable.add(path)
        text = path.read_text(encoding="utf-8")
        pending.extend(markdown_targets(path, text) - reachable)

    active_docs = {
        path
        for path in (REPO_ROOT / "docs").rglob("*.md")
        if not path.relative_to(REPO_ROOT).as_posix().startswith(SKIP_PREFIXES)
    }
    return [
        f"{path.relative_to(REPO_ROOT)}:1: not reachable from docs/README.md"
        for path in sorted(active_docs - reachable)
    ]


def link_exists(resolved: Path, linking_file: Path) -> bool:
    if resolved.exists():
        return True
    if not linking_file.as_posix().startswith(DOCUSAURUS_ROOT):
        return False
    return any(Path(f"{resolved}{suffix}").exists() for suffix in DOCUSAURUS_SUFFIXES)


def check_file(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    rel = path.relative_to(REPO_ROOT)
    problems = check_metadata(path, text)
    if rel.as_posix() in SKIP_FILES or is_historical(text):
        return problems
    if rel.as_posix().startswith(SKIP_PREFIXES):
        return problems

    in_fence = False
    for line_no, line in enumerate(text.splitlines(), start=1):
        if FENCE_RE.match(line):
            in_fence = not in_fence
            continue
        if in_fence:
            continue

        for target in LINK_RE.findall(line):
            if is_external(target) or is_placeholder(target):
                continue
            cleaned = strip_fragment(target)
            if cleaned == "":
                continue
            base = REPO_ROOT if cleaned.startswith("/") else path.parent
            resolved = (base / cleaned.lstrip("/")).resolve()
            if not link_exists(resolved, rel):
                problems.append(f"{rel}:{line_no}: broken link -> {target}")

        for target in BACKTICK_PATH_RE.findall(line):
            if not target.startswith(ROOT_ANCHORED_PREFIXES) or is_placeholder(target):
                continue
            if target in GENERATED_PATHS:
                continue
            if not (REPO_ROOT / strip_fragment(target)).exists():
                problems.append(f"{rel}:{line_no}: dead path -> {target}")

    return problems


def main() -> int:
    problems = []
    files = markdown_files()
    for path in files:
        problems.extend(check_file(path))
    problems.extend(check_routing())

    if problems:
        print(f"Documentation checks failed ({len(problems)}):\n")
        for problem in problems:
            print(f"  {problem}")
        print(f"\nScanned {len(files)} Markdown files.")
        return 1

    print(f"Documentation metadata, routing, and references valid. Scanned {len(files)} Markdown files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
