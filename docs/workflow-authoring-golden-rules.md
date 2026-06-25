# Workflow authoring golden rules

Golden-standard workflows are authored as versioned source packages, then
registered into Mediforce as immutable workflow definition versions. The goal is
that a new operator can read the package, set up the environment, register the
workflow, run it, and understand what each step is allowed to do.

## 1. Author a workflow package

A **Workflow Package** is the source-of-truth bundle for a workflow definition
and its supporting assets. Keep it in git, usually one folder per workflow
inside a workflow repository.

A package should contain:

- the `.wd.json` workflow definition
- Dockerfiles and runtime code used by steps
- workflow-specific runtime skills
- scripts, config examples, fixtures, and sample inputs
- a README with setup, variables, agents, MCPs, and validation notes

The registered **Workflow Definition** is the runnable artifact in Mediforce.
The package repo remains the authoring source of truth.

## 2. Pin runtime sources

Every registered workflow definition should point at immutable source material.

Use commit SHAs for:

- Workflow Package source
- `externalSkillsRepo.commit`
- step Docker build `commit`

Avoid moving branches as runtime references. Avoid `latest` for serious
workflows unless it is only a local development tag. Re-registering a workflow
creates a new workflow definition version; old versions should not be mutated.

If a workflow depends on an Agent, document the expected Agent name, model,
system prompt, MCP bindings, and OAuth setup. Agents are mutable today, so they
are the main reproducibility caveat.

## 3. Use Docker for runtime, not authority

Dockerfiles own the runtime environment. Put OS packages, language runtimes,
CLI tools, deterministic scripts, MCP server executables, and dependency
lockfiles in the image.

Do not put these in Docker images:

- secrets
- workflow graph semantics
- triggers or transitions
- step permissions
- MCP access grants
- deployment-specific endpoints

Rule: Dockerfile supplies capabilities; workflow definition and Agent
configuration grant capabilities.

For custom Docker builds, each buildable step should declare explicit build
provenance:

```json
{
  "agent": {
    "dockerfile": "protocol-to-synthetic-sdtm/Dockerfile",
    "repo": "https://github.com/Appsilon/cdisc-workflows.git",
    "commit": "0123456789abcdef0123456789abcdef01234567"
  }
}
```

The same container fields are available on `script` steps under `script`.
Add `image` only when you need a human-controlled registry tag. Add `repoAuth`
when the build repo is private.

## 4. Co-locate workflow-specific skills

Put workflow-specific runtime skills in the Workflow Package by default.
Use `externalSkillsRepo` to point at the package repo and commit, then set each
agent step's `skill` and `skillsDir`.

Split skills into a separate repo only when they are intentionally shared
assets with their own release discipline.

## 5. Keep data stores distinct

Do not overload one repo field to mean everything.

- Workflow Package repo defines the workflow.
- `externalSkillsRepo` provides runtime skills.
- step `repo + commit + dockerfile` provides Docker build context.
- `workspace.remote` stores run worktree state and produced files.

Use `workspace.remote` only when runs need a shared `/workspace` git worktree
with per-step commits or pushes. If a step only needs structured JSON output or
temporary files, skip `workspace.remote`.

## 6. Choose executor before kind

The workflow JSON has both `executor` and `type`. Teach them separately.

**Step Executor** answers "what runtime performs the work?":

- `action`
- `script`
- `agent`
- `human`
- `cowork`

**Step Kind** answers "what role does this node play in the graph/UI?":

- `creation`
- `review`
- `decision`
- `terminal`

Choose the executor first, then the kind. Most ordinary work steps are
`"type": "creation"` regardless of executor.

Use `review` when a human or L3 agent approval loop decides between verdicts.
Use `decision` only for routing nodes that do not do substantial work. Use
`terminal` only for end states.

## 7. Prefer the least autonomous executor

Use the least autonomous executor that fully solves the step.

- Use `action` for platform-native side effects and orchestration.
- Use `script` for deterministic parsing, validation, conversion, checks, API
  glue, and file operations.
- Use `agent` for judgment, synthesis, language understanding, planning, code
  edits, and flexible interpretation.
- Use `human` for human input, accountability, approval, rejection, or
  classification.
- Use `cowork` for live human-agent collaboration.

Do not use an agent prompt when a built-in action or deterministic script is the
right tool.

## 8. Use built-in actions when available

Use `executor: "action"` for platform-native actions:

- `reshape`: reshape/interpolate data between steps
- `http`: simple external HTTP call
- `email`: platform email delivery
- `spawn`: start child workflow runs, including fan-out
- `wait`: delay, deadline, or condition-based pause

Do not write scripts or agent prompts for these when the built-in action fits.
Use `script` when the side effect needs domain tooling, complex retry logic,
file operations, or validation logic outside the action schema. Use `agent`
only when judgment or language synthesis is part of the step.

## 9. Make environment setup explicit

Docker images should be reusable across deployments. Put non-secret runtime
configuration in workflow `env`; put credentials and sensitive values in
workflow or namespace secrets.

Rules:

- Never bake secrets into Docker images.
- Never commit real secrets to a Workflow Package.
- Prefer workflow-scoped secrets when the value belongs to one workflow.
- Use namespace secrets for shared credentials.
- Reference secrets through Mediforce secret templates.
- Keep deployment-specific non-secret endpoints in `env`, not Dockerfiles.

Every package README must include an environment contract table:

| Name | Secret | Scope | Used by | Meaning | How to set | Example |
|------|--------|-------|---------|---------|------------|---------|
| `CRO_CONTACT_EMAIL_CDISCPILOT01` | yes | workflow | `send-rejection-email` | CRO delivery contact | Workflow secrets panel | `cro@example.test` |

A workflow is not publishable until a new operator can set every required
variable from the README without reading the Dockerfile or step code.

## 10. Make MCPs governable

Adding an MCP executable to a Dockerfile makes it runnable, not governable.
Mediforce can only show, review, scope, and audit MCP access when the MCP is
represented in platform-visible Agent configuration.

For stdio MCPs:

1. Install the MCP executable in the image if the command must exist inside the
   container.
2. Add a namespace-scoped Tool Catalog entry.
3. Bind that catalog entry to an Agent with `AgentDefinition.mcpServers`.
4. Put `allowedTools` on the Agent binding where possible.
5. Reference the Agent from workflow steps with `agentId`.
6. Use step `mcpRestrictions` only to disable a server or deny tools.
7. Document MCP setup, secrets, OAuth/scopes, and affected steps in the package
   README.

Create Tool Catalog entries through the admin UI at
`/{handle}/admin/tool-catalog`, or through the API:

```bash
curl -X POST "http://127.0.0.1:9003/api/admin/tool-catalog?namespace=appsilon" \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: $PLATFORM_API_KEY" \
  -d '{
    "id": "cdisc-library-mcp",
    "command": "cdisc-library-mcp",
    "args": [],
    "env": { "CDISC_API_KEY": "{{SECRET:CDISC_API_KEY}}" },
    "description": "Read-only CDISC Library metadata MCP."
  }'
```

For built-in checked-in workflows only, keep seed entries small and add them to
`data/seeds/tool-catalog.json`. Workflow-specific MCPs can stay namespace-local;
they do not need to become global catalog items.

For HTTP MCPs, bind the Agent directly to the HTTP URL. A stdio Tool Catalog
entry is not required.

## 11. Be conservative with autonomy

Autonomy is about decision authority, not technical difficulty.

- Use `L1` when the agent drafts or advises and a human acts.
- Use `L2` when the agent produces output but a later workflow step reviews or
  routes it.
- Use `L3` when Mediforce's built-in approve/revise loop is desired.
- Use `L4` only for low-risk, reversible, or already-constrained operations.

Do not set `autonomyLevel` on script steps. Pair higher autonomy with narrower
MCP/tool access, tighter output contracts, and explicit failure behavior.

## 12. Define inputs, outputs, and files

Use the right channel for each data shape.

- `triggerInput`: values an operator provides when starting a manual run.
- `triggerPayload`: values supplied by webhook, cron, or manual trigger fire.
- structured step output: values downstream steps or transitions need.
- output files: reports, datasets, exports, logs, and human-inspectable
  artifacts.
- `/workspace`: files that must persist across steps as a git worktree.
- `inputForNextRun`: deliberate cross-run carry-over such as cursors or
  previous listings.

Every non-terminal step should have a documented output contract. Branch
transitions on explicit structured fields or human verdicts, not fragile prose.
Large artifacts belong in output files or `/workspace`, not JSON output.

## 13. Model review and verdicts deliberately

Use `verdicts` only when the next path depends on an explicit review decision.
Keep verdict keys stable and machine-friendly; labels can be human-friendly.

For L3 agent steps, use the built-in keys:

- `approve`
- `revise`

If business routing needs custom labels like `accept_delivery`,
`reject_and_notify`, or `ask_agent_to_revise`, model that as a separate human
`review` step after the agent or script output.

Use `requiresComment: true` for revise/reject-style verdicts where feedback is
needed.

## 14. Make failures visible

Failures should be visible by default. Continuation is only for non-critical
failures that downstream steps intentionally handle.

Rules:

- Default: a failed step fails or pauses the run.
- Use `continueOnError: true` only for non-critical side effects.
- If a script catches errors internally, it must emit structured status such as
  `{ "scriptStatus": "failed", "error": "..." }`.
- Set agent `confidenceThreshold` and `fallbackBehavior` intentionally.
- Prefer `fallbackBehavior: "escalate_to_human"` for regulated or
  decision-heavy work.
- Use `continue_with_flag` only when downstream steps inspect the flag.
- Set and document timeouts for expensive or remote steps.
- Do not use terminal steps to hide failed work as "done."

## 15. Validate before sharing

A Workflow Package is not golden-standard until it has:

- `.wd.json` that passes schema validation or register dry-run
- every custom Dockerfile buildable from the pinned commit
- every script step runnable in its intended image
- every agent step configured with skill or prompt, model, timeout, and output
  contract
- required Agents, Tool Catalog entries, MCP bindings, OAuth, and secrets
  documented
- every env var and secret documented with setup instructions
- every non-terminal step output documented
- transitions branching on structured fields or verdicts
- one happy-path dry run recorded
- at least one failure or empty-input path tested for important branches
- README with operator setup and local/dev instructions

Workflow configs do not need unit tests unless the package contains product
code. They do need dry-run or manual execution evidence before sharing.
