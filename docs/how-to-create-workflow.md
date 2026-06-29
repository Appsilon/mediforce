# How to create a workflow

This guide covers the *process* of authoring a workflow — which path to use, how
to import from git, and how to validate before sharing. For the rules a finished
workflow MUST satisfy, see
[workflow-authoring-golden-rules.md](workflow-authoring-golden-rules.md).

## Pick an authoring path

### Workflow Designer (default)

1. Open **Workflow Designer** in Mediforce.
2. Describe the workflow goal, actors, inputs, outputs, review points, and
   failure behavior.
3. Let Workflow Designer draft the `.wd.json`, render the diagram, and validate
   the schema.
4. Add any platform/package setup the designer flags as manual: Dockerfiles,
   scripts, skills, Tool Catalog entries, Agent Definition MCP bindings, and
   secrets. See the golden rules for what each of these requires.
5. Register or import the workflow as a new version.
6. Run a dry run with a known-good input.

### Agent

- Give the agent
  [workflow-authoring-golden-rules.md](workflow-authoring-golden-rules.md) plus
  the intended workflow goal.
- Ask it to produce the `.wd.json` and any package files.
- Require it to validate against the schema and that checklist before returning
  the result.

### Hand-authoring

Use it only when building a reusable workflow package, maintaining built-in
apps, or adding package assets that Workflow Designer cannot create yet. Follow
the package layout, pinning, and validation rules in the golden rules.

## Learn the schema from examples

The tutorial examples live in
[`docs/workflow-examples`](workflow-examples/README.md) — one concept per file
(review loops, script variants, action steps, triggers, validation gates,
anti-patterns). They are deliberately small and are **not** production packages.
For an end-to-end production-style package, read
[`apps/golden-standard-workflow`](../apps/golden-standard-workflow).

## Import from git

Import is a **one-time copy**, not a live link, and currently supports public
GitHub repos only. Re-import to create a new version. The recorded
`source: { url, path, commit }` is provenance only — it does not drive runtime
cloning, Docker builds, skills, or sync.

Full reference, including the `index.json` manifest and CLI flags:
[`how-to/import-from-git.md`](how-to/import-from-git.md).

## Validate before sharing

Validate the file against the canonical schema (exits non-zero and lists
structured errors when invalid):

```bash
pnpm exec mediforce workflow validate path/to/workflow.wd.json
```

`pnpm exec mediforce workflow schema` prints the schema the validator uses.
To check registration against a specific namespace without writing a version,
use the dry run:

```bash
pnpm exec mediforce workflow register \
  --file path/to/workflow.wd.json \
  --namespace docs \
  --dry-run
```

Then walk the production-ready checklist at the bottom of
[workflow-authoring-golden-rules.md](workflow-authoring-golden-rules.md).
