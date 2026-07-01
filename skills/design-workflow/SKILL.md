---
name: design-workflow
description: Design or edit a Mediforce WorkflowDefinition package through a structured interview. Use when authoring a new workflow from an idea, editing an existing workflow folder, or reviewing whether a workflow follows the golden standards. Interviews the user, challenges the design toward the standards, generates the package, and validates the .wd.json against the current checkout. Triggers include "design a workflow", "author a workflow", "create a .wd.json", "build a workflow package", "edit this workflow", "new Mediforce workflow".
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
metadata:
  author: Mediforce
  version: "1.1"
  domain: workflow-authoring
  complexity: intermediate
  tags: workflow, wd-json, authoring, interview, validation
---

# Design Workflow

Author or edit a Mediforce workflow **package** (a `.wd.json` plus its supporting
files) through a disciplined, interview-driven process. This is the agent form
of the *Workflow Designer* app — same intelligence, run in the repo against the
checked-out source instead of a live UI.

You operationalize the **"Agent" authoring path** in
`docs/how-to-create-workflow.md`: take the golden rules plus the user's goal,
produce the `.wd.json` and package files, and require validation against the
schema and checklist before returning a result.

Do **not** invent rules — or capability limits — from memory. The authority is
the docs and source files below. Read them first, cite them when you push back,
and never re-state their rules as your own prose (that forks the source of
truth). When a user claims the platform can or cannot do something, **resolve it
against the capabilities map and the source files it points at**, not against
recollection. Most "you can't do that in Mediforce" answers are wrong because
the capability lives in code that was never opened (fan-out via `spawn`+`forEach`
and dynamic `assignedTo` are the classic misses).

## Step 0 — Load the knowledge (mandatory, before proposing anything)

Read these before you say a single word about structure:

1. `docs/workflow-capabilities.md` — the capability map: every executor, action
   kind, both expression languages, human-step UI, scripts, and models, each
   cross-referenced to the **source file** that defines it. Read this first so
   you know what is possible. When a design touches a capability, open the
   source file it cites rather than authoring from the summary.
2. `CONTEXT.md` — the glossary. Use canonical names (Namespace, Workflow vs
   Definition vs Run). Challenge any user term that conflicts with it.
3. `docs/workflow-authoring-golden-rules.md` — the MUST / SHOULD / MANUAL
   production checklist. This is the spine of every challenge you make.
4. `docs/workflow-examples/README.md` (start with its capability index) and the
   `01`–`11` example `.wd.json` files in `docs/workflow-examples/` — learn the
   schema by example. `11-fan-out-orchestration.wd.json` is the fan-out /
   child-workflow pattern; the production-scale version is
   `apps/team-pulse/src/team-pulse.wd.json`.
5. `docs/workflow-examples/anti-patterns/` — the invalid shapes to avoid, with
   explanations.

Load on demand, only when the design touches them:

- `docs/adr/0008-step-executor-model.md` — executor model (source of truth for
  `executor`).
- `docs/adr/0006-control-mode-ui-concept.md` — control modes (CM0/CM2/CM3/CM4).
- `docs/how-to/import-from-git.md` and `docs/how-to/docker-image-setup.md`.
- `packages/platform-core/src/schemas/workflow-definition.ts` — the schema
  itself, when an example does not answer a field question.
- `packages/core-actions/src/handlers/` — the real action handlers (`http`,
  `reshape`, `email`, `spawn`, `wait`), when you need an action's exact config.
- `packages/platform-core/src/interpolation.ts` — `${...}` template roots
  (`steps`, `item`, `triggerPayload`, `variables`, `secrets`), and
  `packages/workflow-engine/src/expressions/expression-evaluator.ts` — the
  separate transition `when` language. Open these before claiming a value can't
  be referenced.
- `apps/golden-standard-workflow/` — an end-to-end production-style package, for
  reference reading (not a copy-paste template).

## Step 0b — Pick the mode

Ask, or infer from what the user points you at:

- **create-new** — design from an idea.
- **edit-existing** — modify a workflow package already in a folder. Infer this
  when the user names a folder that contains a `src/*.wd.json`.

For **edit-existing**, first read the existing package — the `.wd.json`, the
`README.md`, and any `container/`, `scripts/`, `skills/` — and give the user a
short "here is what this workflow currently does" recap before interviewing.
That loaded definition is your baseline; you change it, you do not rebuild it.

## Phase 1 — Interview and challenge

Interview the user until you completely understand the workflow. **Ask one
question at a time and wait for the answer.** If a question can be answered by
reading the codebase or the loaded docs, answer it yourself instead of asking.
For each question, give your recommended answer.

You are not a transcriber. Your job is to steer the design toward the golden
standards, which means **pushing back** when the user's idea drifts from them.

### Challenge gate A — does this even need a workflow?

Before decomposing steps: if the whole idea is fetch → transform → write with no
human judgment, no review, and no branching, say so and propose the simpler
shape — a single script, a built-in `action`, or a one-step cron-triggered
workflow. Solve the user's actual goal with the least machinery.

### Challenge gate B — is that really an agent step?

For every step the user calls an *agent* step, test it against the executor
table in golden-rules §5 and ADR-0008:

- Deterministic parsing / validation / conversion / file work / API glue →
  push to `script`.
- A built-in side effect (`reshape`, `http`, `email`, `spawn`, `wait`) → push
  to `action`.
- Only judgment, synthesis, planning, or language understanding stays `agent`.

Pushing back here is mandatory, and you cite the rule when you do.

### Challenge gate C — inline script or pinned command?

For every `script` step, decide where the code lives (see the inline-vs-command
section of `docs/workflow-capabilities.md`):

- **Inline** (`inlineScript` + `runtime`) is the default for small, dependency-
  free glue and prototypes: no repo, no commit, no Dockerfile, auto image per
  runtime.
- **Pinned command** (`command` + custom image via `dockerfile` + `repo` +
  `commit`, or a file mounted through `workspace.remote`) when the code is
  substantial (more than roughly a screen), needs dependencies beyond the
  runtime image, or needs its own tests. Golden-rules: "move substantial runtime
  code out of inline scripts into pinned package files/images."

State the trade-off plainly: pushing to a pinned command is better for
production but pulls in the §2 pinning pipeline (repo URL + commit SHA, resolved
at handoff — see Phase 4). A bare prebuilt image with `command` cannot run a
script **file** from the package unless it is baked into the image or mounted at
`/workspace`; do not propose that shape.

### Coverage

Walk the design tree and resolve, per step where relevant: goal and trigger;
actors; the work each step does; executor and control mode (CM0/CM2/CM3/CM4 —
never create a new CM1/L2 step); review steps and their explicit verdicts;
branching and loops; triggers and data contracts (`triggerInput`,
`triggerPayload`, human `params`, `/output/result.json`); env and secrets;
whether a step needs a custom container or runs on `mediforce-golden-image`; and
any MCPs, skills, or agents needed (flag platform setup as MANUAL).

If the design needs a custom image, external skills, or `workspace.remote`, also
ask **now** for the **git repo URL** the package will live in (and whether the
repo holds one workflow or many — see Phase 2 layout). The URL is not part of the
chicken-and-egg; only the commit SHA is. Fill the URL at generation time so the
only thing deferred to Phase 4 is the SHA.

### Scope of challenge in edit mode

Default: apply gates A and B **only to new or changed steps** — do not
re-litigate steps the user is not touching. **Exception:** if the user asks for
your opinion on the workflow ("what do you think of this", "does this follow the
standards"), switch to a full audit of the whole loaded package against the
golden-rules §9 checklist and report findings, regardless of what is changing.

### End Phase 1 with a confirmed spec

Before generating anything, write a short **workflow spec recap** — modes,
steps, executors, transitions, triggers, contracts, env/secrets, package files
needed — and get the user's explicit confirmation. Do not proceed to Phase 2
until they confirm.

## Phase 2 — Generate (or edit) the package

**Require the target from the user. Do not use a default.** Ask for the **repo
root** (the git repo the package lives in), not a leaf directory — a repo can
hold many workflows. The skill then creates a subfolder named after the workflow
and puts everything for this workflow inside it.

**Canonical layout — one subfolder per workflow, `index.json` at repo root:**

```text
<repo-root>/
  index.json                       # REPO-LEVEL — lists ALL workflows; create or MERGE
  <workflow-name>/
    README.md                      # env contract, secrets, agents, MCPs, images,
                                   #   register/import steps, output contracts, sample input (§1/§6)
    Dockerfile                     # ONLY if a step needs it (§3); at the subfolder root,
                                   #   next to scripts/ — see the build-context invariant below
    src/<workflow-name>.wd.json     # authored from the confirmed spec
    scripts/                       # ONLY if needed
    tests/                         # behavior tests + TEST_SUMMARY.md (Phase 3c)
    skills/<skill>/SKILL.md        # ONLY if an agent step uses one (§4)
    setup/                         # MANUAL: tool-catalog-entry.json, agent-definition.json,
                                   #   ONLY if the workflow uses governable MCPs (§7)
```

**Only `index.json` is repo-level.** Everything else for the workflow lives under
`<workflow-name>/`. When `index.json` already exists at the repo root (a
multi-workflow repo), **merge** this workflow's entry — do not overwrite. Each
`path` is **repo-root-relative**: `<workflow-name>/src/<workflow-name>.wd.json`.

> Golden-rules §1 and `apps/golden-standard-workflow` show the package *as* the
> repo root (`index.json` and `README.md` at the package level). That is the
> single-workflow-repo special case. For a repo that holds several workflows,
> hoist `index.json` to the repo root and nest each workflow in its own subfolder,
> as above. If the user's repo holds exactly one workflow, the package-as-root
> shape from §1 is fine.

### Dockerfile build-context invariant (verify before you commit anything)

Decided by [`docker-image-builder.ts`](../../packages/agent-runtime/src/plugins/docker-image-builder.ts):
the builder clones the whole repo, but resolves the step's `dockerfile` field
**relative to the repo root** and uses the **Dockerfile's own directory** as the
`docker build` context (`buildContext = dirname(dockerfilePath)`). Therefore:

- The step `script.dockerfile` / `agent.dockerfile` value is repo-root-relative:
  `<workflow-name>/Dockerfile`.
- Every `COPY <src> …` in the Dockerfile is relative to the Dockerfile's
  directory — so `<src>` must exist **under that directory**. Put the Dockerfile
  at the workflow-subfolder root so `COPY scripts/ …` resolves to
  `<workflow-name>/scripts/`. Do **not** place it in a `container/` subfolder with
  `scripts/` as a sibling (the classic break: context becomes `container/`, and
  `COPY scripts/` fails). The golden-standard `container/Dockerfile` + sibling
  `scripts/` shape is reference-only and does not build through this path.
- The step `command` must reference the path where `COPY` lands files in the
  image (e.g. `COPY scripts/ /opt/<name>/scripts/` →
  `command: python /opt/<name>/scripts/run.py`).

Get this right **in Phase 2**, before any commit — fixing it later changes the
build context and forces a re-commit (the pinning loop in Phase 4).

Be honest about three tiers, and keep them separate in what you tell the user:

- **Generated and schema-validated** — the `.wd.json`.
- **Templated, NOT runtime-verified** — `Dockerfile`, `scripts/`, `mcp/`. Pattern
  these from golden-rules §3 and the `apps/golden-standard-workflow` package.
  Never free-hand infra and claim it works; a green schema validation does not
  build an image or run a script.
- **MANUAL platform setup** — Tool Catalog entries, Agent Definition MCP
  bindings, secrets. These live outside the `.wd.json`; document them in the
  README, do not pretend the skill configured them.

The `README.md` MUST cover the env-contract table, secrets, agents, MCPs,
images, registration/import steps, output contracts, and a known-good input
(golden-rules §1, §6). The `index.json` follows the §1 shape so the package can
be imported from git.

### Edit mode: edit in place, diff for regressions

Edit the `.wd.json` and only the package files the change touches. **Preserve
what you did not change** — existing `repo`/`commit` pins, `externalSkillsRepo`,
MANUAL `setup/` entries, and steps/transitions unrelated to the change. Do not
hand-bump a `version` field; re-registering is what creates a new version
(`version` and `namespace` are filled in server-side).

Before handoff, diff OLD vs NEW user-observable behavior — removed steps,
changed transitions or verdicts, dropped env, altered output contracts — and
call out any **regression** explicitly. Do not silently restructure.

## Phase 3 — Validate against the current checkout

Validate the `.wd.json` with the CLI. The primary command validates locally
against the checked-out schema, with no running platform:

```bash
pnpm exec mediforce workflow register \
  --file <target>/src/<name>.wd.json \
  --namespace <ns> \
  --dry-run
```

This parses against the current source's `parseWorkflowDefinitionForCreation`
and warns about Docker images it cannot find locally. Use
`pnpm exec mediforce workflow validate <file>` only when you specifically want
to check against a reachable deployment instead of the checkout.

When validation fails:

1. Report the **exact** error message — do not paraphrase.
2. Explain what it means in plain language.
3. Suggest a concrete fix.
4. Apply the fix, re-run, and repeat until clean.

### Model IDs

`pnpm exec mediforce model list` and `pnpm exec mediforce model validate <ids>`
resolve model IDs against the registry, but both **hit the platform** — they need
a reachable deployment and `MEDIFORCE_API_KEY`, so they do **not** work against a
bare checkout. Treat them as optional. When authoring offline:

- Prefer short Claude aliases (`sonnet`, `opus`, `haiku`) — the
  `claude-code-agent` plugin passes `--model` straight through, and the runtime
  default is `anthropic/claude-sonnet-4`.
- Or copy a full ID already used in an example / `apps/*` workflow.
- The registry itself is populated from OpenRouter (`sync-models.ts`); see the
  Models section of `docs/workflow-capabilities.md` for the source pointers.

Run `model validate` only as a best-effort confirmation when a deployment + key
are available; never block authoring on it.

### Phase 3a — Verify the Dockerfile build context

Only when the package has a Dockerfile. Schema validation does not look at the
Dockerfile at all, so prove the build-context invariant (Phase 2) holds **before
the commit** — a failure here, caught after committing, restarts the pinning
loop. For each step that sets `dockerfile`:

1. Assert the `dockerfile` path exists relative to the **repo root**.
2. For every `COPY <src> …` line, assert `<src>` exists relative to the
   Dockerfile's **directory** (the build context).
3. Assert each step `command` script path matches a `COPY` destination in the
   image.

A one-liner that catches the common break (run from the repo root):

```bash
df=<workflow-name>/Dockerfile
ctx=$(dirname "$df")
test -f "$df" || echo "MISSING dockerfile: $df"
grep -E '^\s*COPY ' "$df" | awk '{print $2}' | while read -r src; do
  test -e "$ctx/$src" || echo "COPY src not in build context: $ctx/$src"
done
```

If it prints anything, fix the layout (usually: move the Dockerfile to the
subfolder root next to `scripts/`) and re-check. Report the check ran clean, or
that it was **skipped** (no Dockerfile).

### Phase 3b — Syntax-check every generated script

Schema validation does **not** parse the code inside `inlineScript` or a
`command` script file. Extract each script and run the runtime's own check —
this catches the escaping mistakes that JSON-embedded inline code is prone to:

- `javascript` → `node --check <file.mjs>`
- `python` → `python -m py_compile <file.py>`
- `bash` → `bash -n <file.sh>`
- `r` → `Rscript -e 'invisible(parse(file="<file.R>"))'`

Write each script to a scratch file with the right extension first. If an
interpreter is not installed locally, say the check was **skipped**, do not claim
it passed.

### Phase 3c — Generate and run a behavior test per non-trivial script

Syntax is not behavior. For every non-trivial script, generate and run a small
test that proves it produces the documented output:

1. Build a sample `/output/input.json` from the step's input contract (trigger
   input + upstream step outputs the script reads).
2. Copy the script to a scratch dir, rewriting hard-coded `/output/` paths to the
   scratch dir (this mirrors how local mode runs scripts in
   `script-container-plugin.ts`), and provide the sample `input.json` there.
3. Run it with the runtime, then assert `result.json` parses and matches the
   output shape the README/prompt documents (the keys downstream steps read).
4. Report pass/fail with the actual output. Fix and re-run until green. Skip with
   an explicit note only when the runtime is unavailable locally.

**Persist the tests — do not throw them away.** For every pinned package script,
write the test and its fixtures into `<workflow-name>/tests/` so the user can
re-run them later:

- `tests/fixtures/<step>.input.json` — the sample input you built in step 1.
- `tests/test_<step>.py` (Python — matches the AGENTS.md "scripts in Python"
  rule) — runs the script against the fixture and asserts the documented output
  shape. Reuse the local-mode `/output/`→scratch rewrite from above.
- `tests/run_tests.py` — a single runner that executes every `test_*.py`,
  **skips** (does not fail) any test whose required secrets/env are absent, and
  prints a pass/skip/fail line per script.
- `tests/TEST_SUMMARY.md` — one row per script: `tested` (with the asserted
  shape) / `skipped — needs <ENV/secret>` / `failed`. For each skipped test give
  the **exact command + env vars** the user runs once they have the missing
  pieces (e.g. `KAGGLE_USERNAME=… KAGGLE_KEY=… python tests/run_tests.py`).

Pure-logic scripts MUST be run and green now. Scripts that need live
secrets/network are scaffolded with their fixture and a graceful skip, so the
user runs `python tests/run_tests.py` after adding credentials — never left as an
unverifiable claim. For throwaway *inline* glue (not pinned package files),
running once and reporting is still enough; the `tests/` folder is for pinned
package code.

Then walk the golden-rules §9 production-ready checklist by hand: workflow
validates; README complete; Docker/skills sources pinned by commit; secrets
platform-managed; agent steps have output contracts and timeouts; governable
MCPs in Tool Catalog and Agent Definitions; review steps have explicit verdicts;
failure behavior intentional. **If any runtime source is still UNPINNED (see
Phase 4), the package is not production-ready — say so and do not mark the
checklist complete.**

**Boundary:** a clean dry-run validates the `.wd.json` only, and 3b/3c validate
the scripts in isolation. None of it proves the Dockerfile builds or that the
workflow runs end-to-end on the platform — those are exercised by an actual run.
Say so.

## Phase 4 — Pin runtime sources, then handoff

### Pin (only when the package has a custom image, external skills, or `workspace.remote`)

The `repo` URL is already filled (gathered in Phase 1). Only the **commit SHA**
is chicken-and-egg: it cannot exist until the package is committed. **You** drive
filling it — do not hand the user a manual checklist.

**Pre-condition: the package must be byte-final before the first commit.** This is
what kills the re-commit loop. Phases 3a (Dockerfile/COPY), 3b (syntax), and 3c
(behavior + persisted `tests/`) must all be clean *first*, so that after the
commit the **only** remaining change is filling the SHA. If you change structure
(move the Dockerfile, rename a script) after the commit, the build context
changes and the user must re-commit — that is the loop, and it is avoidable.

1. Author every `commit` / `externalSkillsRepo.commit` field as the sentinel
   `0000000000000000000000000000000000000000` (40 zeros). Never invent a real
   SHA. The all-zeros value is format-valid so the Phase 3 dry-run still passes,
   and is obviously a placeholder. Mark it `UNPINNED` in the README.
2. Ask the user to commit the package once (you do **not** commit — see
   Non-goals) and give you the SHA, or derive it with `git rev-parse HEAD` if the
   package is in this checkout.
3. **You** `Edit` that SHA into every `commit` build-context field and
   `externalSkillsRepo.commit`. The README's pinning section then records **state**
   (`pinned to <repo>@<sha>`), not a to-do list for the user.
4. Re-run the Phase 3 dry-run after filling the SHA.

**Why one commit is enough — the build-context commit and the definition are
decoupled.** Do **not** chase a single unified SHA with `git commit --amend`
(amending orphans the very SHA the `.wd.json` now references):

- Local registration (`mediforce workflow register --file …`) reads the
  **working tree**, not git — so a filled `.wd.json` registers with no further
  commit at all.
- The step `commit` field only needs to point at a **reachable** commit whose
  build context (scripts + Dockerfile) is correct. After the user commits once
  (call it C1) and you fill C1 into the `.wd.json`, committing that fill as a
  child (C2) leaves C1 reachable as C2's parent. The image builds from C1
  regardless of where HEAD moves. The build SHA is allowed to lag HEAD.
- So: **commit once → fill the SHA → done.** Git-*import* mode (Phase 4 handoff)
  uses HEAD/C2 for `--ref` (it carries the filled `.wd.json`); the Docker build
  uses C1 from the `commit` field. Two SHAs, both reachable, no loop.

Until the SHA is filled, the package is **UNPINNED** and not production-ready —
state that. Inline-only / golden-image-only packages need no pinning and skip
this step.

### Handoff

Report the files written, the MANUAL platform setup that remains, and a
known-good input to try. Then give the user the three ways to register, filled in
with their values:

1. **Plain CLI** (local file — reads the working tree, no commit needed):
   ```bash
   pnpm exec mediforce workflow register \
     --file <repo-root>/<workflow-name>/src/<workflow-name>.wd.json --namespace <ns>
   ```
2. **Import from git** (push first; one-time copy, public GitHub only; `--path`
   and `index.json` paths are **repo-root-relative**, `--ref` is HEAD/C2):
   ```bash
   pnpm exec mediforce workflow import \
     --repo <url> --path <workflow-name>/src/<workflow-name>.wd.json \
     --ref <sha> --namespace <ns>
   ```

   When the workflow spawns child workflows, register/import the **children
   first** (the parent references them by name).
3. **UI** — register through Workflow Designer / the app.

## Non-goals

- Do not run `git commit` / `git push` / `git commit --amend` yourself — the
  user owns those. You ask for the commit and the SHA; you only edit files.
- Never target production.
- Never present templated infra (Dockerfile, scripts, MCP) as verified.
