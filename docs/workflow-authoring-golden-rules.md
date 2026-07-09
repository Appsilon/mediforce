# Workflow authoring rules

The production checklist a finished workflow MUST satisfy, whatever authored it.
For the *process* of creating one — which path to use, importing from git,
validating — see [how-to-create-workflow.md](how-to-create-workflow.md).

`MUST` = required for production. `SHOULD` = default unless documented.
`MANUAL` = platform/package setup that lives outside `.wd.json` (Dockerfiles,
Tool Catalog entries, Agent Definition bindings, secrets).

Learn the schema from the tutorial examples in
[`docs/workflow-examples`](workflow-examples/README.md) and the end-to-end
reference package [`apps/golden-standard-workflow`](../apps/golden-standard-workflow).
For the map of what workflows can do (actions, fan-out, expression languages,
human UI, scripts, models) to the source files that define each, see
[workflow-capabilities.md](workflow-capabilities.md).
Examples are tutorials, not copy-paste templates: production workflows SHOULD
move substantial runtime code out of inline scripts and into pinned package
files/images.

## 1. Package The Workflow

Keep production workflows in repo folders. Use private repos unless the workflow
is intentionally public. The canonical layout is
[`apps/golden-standard-workflow`](../apps/golden-standard-workflow):

```text
workflow-repo/
  index.json
  README.md
  src/my-workflow.wd.json
  container/Dockerfile
  skills/my-skill/SKILL.md
  scripts/
  mcp/
```

`README.md` MUST document: env vars, secrets, Agents, MCPs, Docker images,
registration/import steps, output contracts, and a known-good input.

The layout above is the **single-workflow repo** case (package == repo root).
For a repo holding **several** workflows, keep one subfolder per workflow
(`<workflow-name>/README.md`, `<workflow-name>/src/<workflow-name>.wd.json`,
`<workflow-name>/Dockerfile`, …) and hoist a single `index.json` to the repo
root listing every workflow with repo-root-relative `path`s
(`<workflow-name>/src/…`).

`index.json` SHOULD exist for standalone workflow repos that are imported via
Git browse mode. Each `path` is relative to the repo root and must point at the
`.wd.json`:

```json
{
  "workflows": [
    {
      "name": "my-workflow",
      "path": "src/my-workflow.wd.json",
      "description": "Short operational description",
      "tags": ["domain"]
    }
  ]
}
```

Git import is a one-time copy of public GitHub repos and stores
`source: { url, path, commit }` as provenance only — it does not drive runtime.
See [how-to-create-workflow.md](how-to-create-workflow.md#import-from-git) and
[`import-from-git.md`](how-to/import-from-git.md).

## 2. Pin Runtime Sources

MUST (once you build a custom image or pin sources):

- Pin `externalSkillsRepo.commit`.
- Pin step Docker build `repo + commit + dockerfile`.
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

Concrete package example:

- Dockerfile: [`apps/golden-standard-workflow/container/Dockerfile`](../apps/golden-standard-workflow/container/Dockerfile)
- Scripts copied into the image: [`apps/golden-standard-workflow/scripts`](../apps/golden-standard-workflow/scripts)
- MCP executable copied into the image: [`apps/golden-standard-workflow/mcp`](../apps/golden-standard-workflow/mcp)

To push a prebuilt image to a registry instead of the auto-build path, see
[`how-to/docker-image-setup.md`](how-to/docker-image-setup.md).

Dockerfile pattern (everything after `FROM` is optional — include only what the
step actually needs):

```dockerfile
FROM mediforce-golden-image

# optional — only if a step needs OS packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends jq ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# optional — pinned language packages (incl. MCPs published as pip packages)
RUN pip install --no-cache-dir --break-system-packages \
    "pydantic==2.11.7"

# optional — only if you ship workflow scripts
COPY scripts/ /opt/my-workflow/scripts/
# optional — only if you bake an MCP executable into the image
COPY mcp/ /opt/my-workflow/mcp/

WORKDIR /workspace
```

Workflow step using that Dockerfile in build mode:

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

Workflow-specific skills SHOULD live in the workflow package.

```json
{
  "externalSkillsRepo": {
    "url": "https://github.com/acme/workflow-repo.git",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  },
  "agent": {
    "skill": "my-skill",
    "skillsDir": "my-workflow/skills"
  }
}
```

Use a separate skills repo only when the skills are shared products with their
own release process.

## 5. Choose Control Mode, Executor, Type

Workflow Designer presents **Control Mode** — a UI-only concept. `.wd.json`
still stores `executor` and sometimes `autonomyLevel`. The mode↔shape mapping is
defined by [ADR-0006](adr/0006-control-mode-ui-concept.md); the executor model
is [ADR-0008](adr/0008-step-executor-model.md). Treat those ADRs as the source
of truth — the load-bearing rules are:

- **CM0 No agent** (`executor: human`/`script`/`action`) for human work,
  deterministic scripts, and built-in actions.
- **CM2 Cowork** (`executor: cowork`) for live human-agent collaboration.
- **CM3 Human review** (`executor: agent`, `autonomyLevel: L3`) — the built-in
  agent approve/revise loop.
- **CM4 Autonomous** (`executor: agent`, `autonomyLevel: L4`) for unsupervised
  advance after prior constraints/approval.
- Do **not** create new CM1/L2 ("Assist") steps — backward compatibility only.

`executor` and step `type` are schema enums in
[`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts)
(`executor: 'human' | 'agent' | 'script' | 'cowork' | 'action'`,
`type: 'creation' | 'review' | 'decision' | 'terminal'`). Pick by intent:

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

- Never commit real secrets.
- Never bake secrets into Docker images.
- Put non-secret deployment config in workflow or step `env`.
- Put credentials in workflow or namespace secrets.
- Reference secrets through `{{SECRET_NAME}}` templates.
- Explain every variable in the package README.

README env contract:

| Name | Secret | Scope | Used by | Meaning | How to set | Example |
|------|--------|-------|---------|---------|------------|---------|
| `CDISC_API_KEY` | yes | workflow | `fetch-standard` | CDISC Library API key | Workflow secrets panel | `cdisc-...` |
| `APP_BASE_URL` | no | namespace | `notify-reviewer` | Mediforce base URL | Namespace env or workflow env | `https://staging.example.com` |

Example: [`06-env-secrets-databricks.wd.json`](workflow-examples/06-env-secrets-databricks.wd.json).

## 7. Make MCPs Governable

Installing an MCP executable in Docker makes it runnable. It does not make it
visible, reviewable, scoped, or auditable in Mediforce.

`MANUAL`: Workflow Designer can reference `agentId` and `mcpRestrictions`, but
Tool Catalog entries and Agent Definition MCP bindings are platform setup.

MUST for governable MCPs:

1. Add the executable to the Docker image if runtime needs it.
2. Add a namespace Tool Catalog entry in `/{handle}/admin/tool-catalog`.
3. Bind that catalog entry to an Agent Definition.
4. Set Agent binding `allowedTools` when only some tools are needed.
5. Reference the Agent from workflow steps with `agentId`.
6. Narrow per-step access with `mcpRestrictions` only.
7. Document setup, secrets, OAuth/scopes, and affected steps in `README.md`.

Tool Catalog entry:

```json
{
  "id": "golden-standard-readonly-context",
  "command": "python",
  "args": ["/opt/golden-standard/mcp/readonly_context_mcp.py"],
  "env": { "CONTEXT_TOKEN": "{{SECRET:CONTEXT_TOKEN}}" },
  "description": "Read-only context MCP."
}
```

Agent Definition binding:

```json
{
  "mcpServers": {
    "readonly-context": {
      "type": "stdio",
      "catalogId": "golden-standard-readonly-context",
      "allowedTools": ["read_context", "list_context"]
    }
  }
}
```

Workflow step restriction:

```json
{
  "agentId": "golden-standard-reviewer",
  "mcpRestrictions": {
    "readonly-context": { "denyTools": ["write_context"] }
  }
}
```

Do not put MCP definitions inside workflow step `agent` or `cowork` config in
new workflows. Those step-level fields are deprecated. `AgentDefinition.mcpServers`
is current.

HTTP MCPs can be bound directly on the Agent Definition. Stdio MCPs SHOULD use
Tool Catalog entries.

## 8. Define Data Contracts

| Channel | Use for |
|---------|---------|
| `triggerInput` | Manual start form fields |
| `triggerPayload` | Webhook, cron, or scheduled payload |
| human `params` | Data collected from a human step |
| `/output/input.json` | Runtime input snapshot for containers |
| `/output/result.json` | Structured step output |
| `/output/*` | Preserved run output files |
| `workspace.remote` | Shared per-run git worktree mounted at `/workspace` |
| `inputForNextRun` | Values carried into the next run |

Every script and agent step MUST document its output JSON shape. Agent prompts
MUST require writing `/output/result.json`.

## 9. Review, Failure, Validation

Use CM3/L3 for Mediforce's built-in agent approve/revise loop. L3 revision
currently keys off literal `approve` and `revise`; custom verdict keys belong
on a separate human `type: review` step (a current, non-deprecated step type).

Human review steps MUST define explicit `verdicts`. Use `requiresComment: true`
for revise/reject-style verdicts.

Default failure behavior SHOULD be fail-fast. Use `continueOnError: true` only
for non-critical side effects that may fail while the run continues.

Validate before sharing with `mediforce workflow validate` (see
[how-to-create-workflow.md](how-to-create-workflow.md#validate-before-sharing)).

Production-ready checklist:

- Workflow validates.
- README explains env vars, secrets, Agents, MCPs, images, and sample input.
- Docker build contexts and skills sources are pinned by commit.
- Secrets are platform-managed, not committed.
- Agent steps have output contracts and timeouts.
- MCPs that need governance are in Tool Catalog and Agent Definitions.
- Review steps have explicit verdicts.
- Failure behavior is intentional.
