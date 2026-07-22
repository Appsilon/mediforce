#!/usr/bin/env python3
"""Bake the workflow-authoring docs into the workflow-assistant system prompt.

The in-canvas AI Assistant's system prompt embeds three docs as its capability
and authoring reference. `platform-api` is consumed as source by several
runtimes (the Next.js app, the CLI, vitest) with no single bundler, so instead
of a build-time loader we generate one committed TypeScript module that exports
the docs as string constants. `system-prompt.ts` imports it normally.

Run `pnpm gen:assistant-docs` after editing any of the source docs. A unit test
(`embedded-workflow-docs.test.ts`) fails if the generated file drifts from the
live docs, so a forgotten regen is caught in CI.
"""

import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# (source doc, exported constant name)
DOCS = [
    ("docs/how-to-create-workflow.md", "HOW_TO_CREATE_WORKFLOW_DOC"),
    ("docs/workflow-capabilities.md", "WORKFLOW_CAPABILITIES_DOC"),
    ("docs/workflow-authoring-golden-rules.md", "WORKFLOW_AUTHORING_GOLDEN_RULES_DOC"),
]

OUT = REPO_ROOT / (
    "packages/platform-api/src/handlers/workflow-assistant/_lib/"
    "embedded-workflow-docs.generated.ts"
)


def main() -> None:
    lines = [
        "// AUTO-GENERATED — do not edit by hand.",
        "// Source: the docs listed below. Regenerate with `pnpm gen:assistant-docs`",
        "// after editing them; embedded-workflow-docs.test.ts fails on drift.",
        "",
    ]
    for rel_path, const_name in DOCS:
        text = (REPO_ROOT / rel_path).read_text(encoding="utf-8")
        # json.dumps yields a valid TypeScript double-quoted string literal with
        # every character (backticks, ${}, newlines, quotes) safely escaped.
        lines.append(f"/** Verbatim contents of `{rel_path}`. */")
        lines.append(f"export const {const_name} = {json.dumps(text)};")
        lines.append("")

    OUT.write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {OUT.relative_to(REPO_ROOT)} from {len(DOCS)} docs.")


if __name__ == "__main__":
    main()
