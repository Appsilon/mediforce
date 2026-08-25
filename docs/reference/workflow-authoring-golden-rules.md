---
status: living
audience: workflow-authors
last_reviewed: 2026-08-19
---

# Workflow authoring rules

The production checklist a finished workflow MUST satisfy, whatever authored it.
For the *process* of creating one see [create-workflow.md](../guides/create-workflow.md);
for what workflows can do, mapped to source, [workflow-capabilities.md](workflow-capabilities.md);
for the schema by example [`docs/workflow-examples`](../workflow-examples/README.md)
and the end-to-end reference package
[`apps/golden-standard-workflow`](../../apps/golden-standard-workflow).

`MUST` = required for production. `SHOULD` = default unless documented.
`MANUAL` = platform setup that lives outside `.wd.json` (Dockerfiles, Tool
Catalog entries, Agent Definition bindings, secrets).

Examples are tutorials, not copy-paste templates: production workflows SHOULD
move substantial runtime code out of inline scripts and into pinned package
files/images.

## 1. Package The Workflow

Keep production workflows in repo folders — private unless the workflow is
intentionally public. The canonical layout is
[`apps/golden-standard-workflow`](../../apps/golden-standard-workflow):

```text
workflow-repo/
  workflows-index.json
  README.md
  src/my-workflow.wd.json
  container/Dockerfile
  skills/my-skill/SKILL.md
  scripts/
  mcp/
  setup/            # MANUAL: Tool Catalog entry + Agent Definition (§7)
```

`README.md` MUST document: env vars, secrets, Agents, MCPs, Docker images,
registration/import steps, output contracts, and a known-good input.

That is the **single-workflow repo** case (package == repo root). A repo holding
**several** workflows keeps one subfolder per workflow (`<name>/README.md`,
`<name>/src/<name>.wd.json`, `<name>/container/Dockerfile`, …) and one
`workflows-index.json` at the top listing all of them.

`workflows-index.json` SHOULD exist for repos imported via Git browse mode. Each
`path` points at a `.wd.json` relative to the **source root** — the repo root, or
the subdirectory a `/tree/<ref>/<dir>` URL pointed at. Manifest format:
[`import-from-git.md`](../guides/import-from-git.md#workflows-indexjson-manifest-format).

Git import is a one-time copy of public GitHub repos and stores
`source: { url, path, commit }` as provenance only — it does not drive runtime.
See [create-workflow.md](../guides/create-workflow.md#import-from-git) and
[`import-from-git.md`](../guides/import-from-git.md).

## 2. Pin Runtime Sources

MUST (once you build a custom image or pin sources):

- Pin `externalSkillsRepo.commit`.
- Pin step Docker build `repo` + `commit` + `dockerfile`.
- Avoid `latest` image tags outside local development.
- Register/import a new workflow version for every released change.

The four repo-shaped fields control different things — keep them separate:

| Field | Purpose |
|-------|---------|
| `source` | Git import provenance only (no runtime effect) |
| `externalSkillsRepo` | Runtime skill source |
| step `agent.repo` / `script.repo` | Docker build context |
| `workspace.remote` | Optional per-run `/workspace` git worktree |

## 3. Use Docker For Runtime Setup

Start from `mediforce-golden-image` with no custom Dockerfile. Add one only when
a step needs OS packages, language packages, CLIs, lockfiles, MCP executables,
or deterministic scripts baked into the image. Once you do, the pinning rules in
§2 become MUST.

Dockerfiles MUST NOT contain secrets, graph semantics, triggers, transitions,
permissions, MCP grants, or deployment-specific endpoints.

A Dockerfile is `FROM mediforce-golden-image` plus only what the step actually
needs — pinned `apt-get` / `pip install`, `COPY scripts/`, `COPY mcp/`,
`WORKDIR /workspace`. Working example and the assets it copies in:
[`container/Dockerfile`](../../apps/golden-standard-workflow/container/Dockerfile),
[`scripts/`](../../apps/golden-standard-workflow/scripts),
[`mcp/`](../../apps/golden-standard-workflow/mcp). To push a prebuilt image to a
registry instead of the auto-build path, see
[`docker-image-setup.md`](../guides/docker-image-setup.md).

The step fields that select build mode:

```json
{
  "script": {
    "dockerfile": "container/Dockerfile",
    "repo": "https://github.com/acme/workflow-repo.git",
    "commit": "0123456789abcdef0123456789abcdef01234567",
    "command": "python scripts/run.py"
  }
}
```

Use `repoAuth` for private Docker build contexts.

## 4. Wire Skills Explicitly

Workflow-specific skills SHOULD live in the workflow package: pin
`externalSkillsRepo` at workflow level, and point the step at `agent.skill` plus
`agent.skillsDir` (the skills folder's path inside that repo). Use a separate
skills repo only when the skills are shared products with their own release
process.

```json
{
  "externalSkillsRepo": {
    "url": "https://github.com/acme/workflow-repo.git",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  },
  "agent": { "skill": "my-skill", "skillsDir": "my-workflow/skills" }
}
```

## 5. Choose Control Mode, Executor, Type

Workflow Designer presents **Control Mode** — a UI-only concept. `.wd.json`
still stores `executor` and sometimes `autonomyLevel`. The mode↔shape mapping is
defined by [ADR-0014](../adr/0014-control-mode-ui-concept.md); the executor model
is [ADR-0008](../adr/0008-step-executor-model.md). Treat those ADRs as the source
of truth — the load-bearing rules are:

- **CM0 No agent** (`executor: human`/`script`/`action`) for human work,
  deterministic scripts, and built-in actions.
- **CM2 Cowork** (`executor: cowork`) for live human-agent collaboration.
- **CM3 Human review** (`executor: agent`, `autonomyLevel: L3`) — the built-in
  agent approve/revise loop.
- **CM4 Autonomous** (`executor: agent`, `autonomyLevel: L4`) for unsupervised
  advance after prior constraints/approval.
- Do **not** create new CM1/L2 ("Assist") steps — the mode is disabled in the
  picker and L2 is retained for backward compatibility only.

`executor` and step `type` are schema enums in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).
Pick by intent:

| Executor | Use for |
|----------|---------|
| `action` | Built-in side effects: `reshape`, `http`, `email`, `spawn`, `wait` |
| `script` | Deterministic parsing, validation, conversion, file work, API glue |
| `agent` | Judgment, synthesis, planning, language understanding, flexible edits |
| `human` | Input, accountability, approval, rejection, classification |
| `cowork` | Live human-agent collaboration |

| Type | Use for |
|------|---------|
| `creation` | Normal work step. Most steps are this. |
| `review` | Human business review with explicit verdicts |
| `decision` | Routing-only node |
| `terminal` | End state |

Do not set `autonomyLevel` on non-agent steps. Use CM3/L3 when a human must
approve agent output; use a separate human `type: review` step for custom
business verdicts.

## 6. Declare Env And Secrets

MUST:

- Never commit real secrets, and never bake them into Docker images.
- Put non-secret deployment config in workflow or step `env`.
- Put credentials in workflow or namespace secrets, referenced as `{{NAME}}`
  (or the namespaced `{{SECRET:name}}` form used by Tool Catalog entries).
- Explain every variable in the package README.

README env contract:

| Name | Secret | Scope | Used by | Meaning | How to set | Example |
|------|--------|-------|---------|---------|------------|---------|
| `CDISC_API_KEY` | yes | workflow | `fetch-standard` | CDISC Library API key | Workflow secrets panel | `cdisc-...` |
| `APP_BASE_URL` | no | namespace | `notify-reviewer` | Mediforce base URL | Namespace env or workflow env | `https://staging.example.com` |

Example: [`06-env-secrets-databricks.wd.json`](../workflow-examples/06-env-secrets-databricks.wd.json).

## 7. Make MCPs Governable

Installing an MCP executable in Docker makes it runnable. It does not make it
visible, reviewable, scoped, or auditable in Mediforce.

`MANUAL`: a workflow can reference `agentId` and `mcpRestrictions`, but Tool
Catalog entries and Agent Definition MCP bindings are platform setup.

MUST for governable MCPs:

1. Add the executable to the Docker image if runtime needs it.
2. Add a namespace Tool Catalog entry in `/{handle}/admin/tool-catalog` — shape:
   [`setup/tool-catalog-entry.json`](../../apps/golden-standard-workflow/setup/tool-catalog-entry.json).
3. Bind that entry to an Agent Definition through `mcpServers.<name>.catalogId` —
   [`setup/agent-definition.json`](../../apps/golden-standard-workflow/setup/agent-definition.json).
4. Set the binding's `allowedTools` when only some tools are needed.
5. Reference the Agent from workflow steps with `agentId`.
6. Narrow per-step access with `mcpRestrictions` only (subtractive) — see the
   `agent-review` step in
   [`golden-standard-workflow.wd.json`](../../apps/golden-standard-workflow/src/golden-standard-workflow.wd.json).
7. Document setup, secrets, OAuth/scopes, and affected steps in `README.md`.

HTTP MCPs can be bound directly on the Agent Definition; stdio MCPs SHOULD use
Tool Catalog entries. Do not put MCP definitions inside workflow step `agent` or
`cowork` config in new workflows — those step-level fields are deprecated,
`AgentDefinition.mcpServers` is current.

## 8. Define Data Contracts

| Channel | Use for |
|---------|---------|
| `triggerInput` | The workflow's **total input contract** — every trigger (manual form, webhook body, cron row payload) validates against it; a field's `default` is filled in for any firing that omitted it |
| `triggerPayload` | The validated input at runtime: `${triggerPayload.<field>}`, identical whichever trigger fired |
| `triggerContext` | Transport-only escape hatch (webhook headers/query/method/path, cron firedAt/schedule) — never declared input |
| human `params` | Data collected from a human step |
| `/output/input.json` | Runtime input snapshot for containers |
| `/output/result.json` | Structured step output |
| `/output/*` | Preserved run output files |
| `workspace.remote` | Shared per-run git worktree mounted at `/workspace` |
| `inputForNextRun` | Values carried into the next run |

Every script and agent step MUST document its output JSON shape. Agent prompts
MUST require writing `/output/result.json`.

## 9. Review, Failure, Validation

Use CM3/L3 for Mediforce's built-in agent approve/revise loop. L3 revision keys
off the literal `approve` and `revise` verdicts; custom verdict keys belong on a
separate human `type: review` step, which keeps working for existing workflows —
but per [ADR-0014](../adr/0014-control-mode-ui-concept.md) the designer no longer
offers that type for new steps, so reach for CM3 when authoring.

Human review steps MUST define explicit `verdicts`. Use `requiresComment: true`
for revise/reject-style verdicts.

Default failure behavior SHOULD be fail-fast. Use `continueOnError: true` only
for non-critical `action` steps that may fail while the run continues — it is
the only executor whose runtime honours the flag.

Verify before sharing by working up the four gates — schema validation, workflow
readiness check, Dry Run, Run — each answering a different question. See
[`verify-a-workflow.md`](../guides/verify-a-workflow.md) and
[create-workflow.md](../guides/create-workflow.md#verify-before-sharing).

Production-ready checklist:

- Workflow validates.
- README explains env vars, secrets, Agents, MCPs, images, and sample input.
- Docker build contexts and skills sources are pinned by commit.
- Secrets are platform-managed, not committed.
- Agent steps have output contracts and timeouts.
- MCPs that need governance are in Tool Catalog and Agent Definitions.
- Review steps have explicit verdicts.
- Failure behavior is intentional.
