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

### Agent — the `/design-workflow` skill

Run the [`design-workflow`](../skills/design-workflow/SKILL.md) skill. It is the
agent form of Workflow Designer: same intelligence, driven against the
checked-out source instead of a live UI. Invoke it with `/design-workflow` (or
just ask an agent to "design a workflow" / "author a workflow"), then follow the
interview.

What the skill does for you:

1. **Loads the authority first.** It reads the capability map, `CONTEXT.md`
   glossary, the golden rules, and the `docs/workflow-examples/` files before
   proposing structure — so it authors from the source of truth, not from
   memory.
2. **Picks a mode.** `create-new` from an idea, or `edit-existing` when you
   point it at a folder that already contains a `src/*.wd.json` (it recaps the
   current workflow before touching it).
3. **Interviews and challenges.** One question at a time, it steers the design
   toward the golden standards — pushing back when a step should be a `script`
   or `action` rather than an `agent`, when the whole thing needs no workflow at
   all, and when substantial script code should move from inline to a pinned
   command. It ends with a written spec recap you confirm before any files are
   generated.
4. **Generates the package.** The `.wd.json` plus `README.md`, `index.json`, and
   only the `Dockerfile` / `scripts/` / `skills/` / `setup/` the design actually
   needs, in the canonical repo layout. It is honest about three tiers:
   schema-validated (`.wd.json`), templated-but-not-runtime-verified (infra),
   and MANUAL platform setup (Tool Catalog, Agent Definitions, secrets).
5. **Validates against this checkout.** Runs the `register --dry-run` schema
   check, verifies the Dockerfile build context, syntax-checks every generated
   script, and runs a behavior test per non-trivial script (persisting tests
   under `tests/`).
6. **Pins runtime sources and hands off.** Fills each `commit` with an all-zeros
   sentinel until you commit once and give it the real SHA, which it edits in —
   then reports the files written, the MANUAL setup left, and the register /
   import / UI commands filled in with your values.

The skill does **not** run `git commit` / `push` for you and never targets
production — you own the commit and the SHA.

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
