---
status: living
audience: workflow-authors
last_reviewed: 2026-08-19
---

# Workflow capabilities

What a Mediforce workflow can actually do, mapped to the **source files** that
define and run each capability. Read this before deciding something is
impossible — most "you can't do that" answers are wrong because the capability
lives in code the reader never opened.

This file is a **map, not a spec**: it names the authoritative file instead of
restating its rules. Before using a capability, open its **Source** and read the
real schema / handler; cite that file when you tell a user something is or isn't
possible. Production checklist:
[`workflow-authoring-golden-rules.md`](workflow-authoring-golden-rules.md).
Schema by example: [`workflow-examples/`](../workflow-examples/README.md).

## Executors — what a step can be

The executor enum and per-executor config are in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts);
the model is [ADR-0008](../adr/0008-step-executor-model.md), control modes are
[ADR-0014](../adr/0014-control-mode-ui-concept.md). The canonical use table is
golden-rules §5 — do not duplicate it here.

| Executor | Capability headline | Source |
|----------|--------------------|--------|
| `human` | Forms, approvals, classification, table editing; can be pre-assigned to a user | `WorkflowStepSchema` (`ui`, `params`, `verdicts`, `selection`, `assignedTo`) |
| `agent` | LLM judgment/synthesis; CM3 approve-revise loop (`autonomyLevel`) | `WorkflowAgentConfigSchema` |
| `script` | Deterministic code — inline or command, four runtimes | `ScriptStepConfigSchema` + [`script-container-plugin.ts`](../../packages/agent-runtime/src/plugins/script-container-plugin.ts) |
| `cowork` | Live human-agent chat or voice-realtime collaboration | `WorkflowCoworkConfigSchema` |
| `action` | Built-in side effects (see below) | `ActionConfigSchema` |

## Actions — built-in side effects (this is where fan-out lives)

Action `kind` is a discriminated union in `ActionConfigSchema`
([`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts));
each kind is dispatched by [`registry.ts`](../../packages/core-actions/src/registry.ts)
to a handler in [`core-actions/src/handlers/`](../../packages/core-actions/src/handlers/).

| `kind` | What it does | Config schema |
|--------|--------------|---------------|
| `http` | Outbound HTTP request, templated url/body/headers | `HttpActionConfigSchema` |
| `reshape` | Pure data transform — rebuild an object from interpolated leaves | `ReshapeActionConfigSchema` |
| `email` | Send email (Mailgun/SMTP; disabled when `MEDIFORCE_DISABLE_EMAIL=true`) | `EmailActionConfigSchema` |
| `spawn` | Launch child workflow run(s); **`forEach` fans out one child per item** | `SpawnActionConfigSchema` |
| `wait` | Pause the run until a `duration` or `deadline` elapses | `WaitActionConfigSchema` |

**Fan-out** (the "spawn a workflow per team member" pattern) is
`action.kind: spawn` with `forEach: "${steps.x.list}"` and a single `targets`
template using `${item.*}`; the rationale for child runs over parallel branches
is [ADR-0018](../adr/0018-fan-out-is-child-workflows.md). End-to-end working
example: [`apps/team-pulse/src/team-pulse.wd.json`](../../apps/team-pulse/src/team-pulse.wd.json)
(`spawn_perspectives` → `wait` → `collect_responses`), distilled in
[`workflow-examples/11-fan-out-orchestration.wd.json`](../workflow-examples/11-fan-out-orchestration.wd.json).

Handler nuances not visible in the schema (in
[`core-actions/src/handlers/`](../../packages/core-actions/src/handlers/)):
- `spawn` fan-out is **capped at 50 children per step execution**
  ([`spawn.ts`](../../packages/core-actions/src/handlers/spawn.ts)); `continueOnSpawnError`
  (default `true`) decides whether one failed child aborts the action. Each
  interpolated child payload is validated against that child's `triggerInput`
  contract before firing; a mismatch is reported in `errors[]` (or aborts when
  `continueOnSpawnError: false`).
- `wait` **requires `duration` or `deadline`** — a condition-only wait throws
  `Invalid deadline` ([`wait.ts`](../../packages/core-actions/src/handlers/wait.ts)).
  The optional `condition` is an early exit *on top of* that timer: it is
  interpolated at pause time, stored on the sentinel, and re-evaluated with
  transition-`when` syntax by
  [`resume-wait.ts`](../../packages/platform-api/src/handlers/processes/resume-wait.ts)
  (`resumeReason: condition_met`) on every cron-heartbeat sweep, so resume
  granularity is ~15 minutes. It sees only **this run's** step outputs, so
  it cannot wait for spawned children — see [ADR-0018](../adr/0018-fan-out-is-child-workflows.md)
  and [#1215](https://github.com/Appsilon/mediforce/issues/1215).
- `email` supports `cc` / `bcc` / `replyTo` / `html` and is **rate-limited**
  (default 50/run, 30/minute) in [`email.ts`](../../packages/core-actions/src/handlers/email.ts).
- `http` never throws on a non-2xx response — it returns `{ status, headers, body }`;
  only transport failures throw ([`http.ts`](../../packages/core-actions/src/handlers/http.ts)).

## Two expression languages — do not mix them

| Use site | Syntax | Roots available | Source |
|----------|--------|-----------------|--------|
| Transition `when`, `wait` `condition` | bare, no `${}`: `verdict == "x"`, `output.f > 1`, `&&`, `\|\|`, `!` | `output`, `variables`, `verdict` | [`expression-evaluator.ts`](../../packages/workflow-engine/src/expressions/expression-evaluator.ts) |
| Action configs, `spawn` payloads, `assignedTo`, step `env`, http body | `${...}` templates with dot/index paths | `steps`, `item` (in `forEach`), `triggerPayload`, `triggerContext`, `variables`, `secrets` | [`interpolation.ts`](../../packages/platform-core/src/interpolation.ts) |

Notes that trip people up:
- `triggerInput` is the workflow's **total input contract**, and every trigger
  validates against it (ADR-0012). Its values arrive at runtime as
  `${triggerPayload.*}`, not `${triggerInput.*}` — identically whether a manual
  form, a webhook body, or a cron row's static payload supplied them.
- `${triggerContext.*}` is the transport escape hatch (webhook
  `headers`/`query`/`method`/`path`, cron `firedAt`/`schedule`). It carries no
  declared input, and bare identifiers deliberately do **not** fall through to
  it — a step reading it has knowingly coupled itself to one trigger kind.
- `${steps.<id>.<path>}` reads a previous step's output; `getPath` supports
  `a.b`, `a.0.x`, and `a[0].x`, and returns empty for missing paths.
- Step ids inside a bare expression must use **underscores**: the parser reads
  `output.spawn-perspectives.x` as subtraction. `${...}` templates are unaffected.
- `${secrets.NAME}` resolves in any action config field (never in transition
  `when` or human-step config) and is **not scrubbed from output**: handlers
  that echo their interpolated config persist it —
  [`reshape.ts`](../../packages/core-actions/src/handlers/reshape.ts) returns its
  `values`, [`email.ts`](../../packages/core-actions/src/handlers/email.ts) writes
  back `to`/`subject`. Keep `${secrets.*}` in fields that are not echoed: `http`
  url/headers/body (only the *response* is stored) and `email` `body`/`html`.

## Human steps — richer than "a form"

All on `WorkflowStepSchema` in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts);
shared sub-schemas (`StepUiSchema`, `StepParamSchema`, `VerdictSchema`,
`SelectionSchema`) live in `process-definition.ts`.

| Capability | Field | Notes |
|-----------|-------|-------|
| Custom UI component | `ui.component` + `ui.config` | Resolved by [`task-body-registry.tsx`](../../packages/platform-ui/src/components/tasks/task-body-registry.tsx); registered ids are `file-upload`, `assignment-table`, `table-editor` (each renders its own view). `table-editor` columns support a `kind` (e.g. `avatar`). Unknown ids fall back to the params/verdict/selection views |
| Collected inputs | `params` | `StepParamSchema` fields: `type` (widget hint — `textarea`, `multiselect`, … falling back to text), `options` (dropdown), `default`, `required`, and `requiredForVerdicts` (required only for named verdicts) |
| Business verdicts | `verdicts` | `VerdictSchema`: `target` + `label`, `intent` (`success`/`danger`/`warning`/`neutral`), `requiresComment`. Defaults filled by [`verdicts.ts`](../../packages/platform-core/src/schemas/verdicts.ts). Routed by transition `when: verdict == "..."` |
| Pick from a list | `selection` | `SelectionSchema`: a number (exact count) or `{ min, max }` range |
| **Dynamic assignee** | `assignedTo` | `${...}`-interpolated user id; only valid on `executor: human`; the engine resolves it and marks the task `claimed` — [`workflow-engine.ts`](../../packages/workflow-engine/src/engine/workflow-engine.ts) |
| Role gating | `allowedRoles` | **Enforced on claim and complete** ([ADR-0019](../adr/0019-workspace-scoped-roles.md)): the caller must hold one of the listed Roles in the run's workspace. Absent or empty means any workspace member, as before. Roles are granted per workspace (`mediforce namespace set-member-roles`), and a role nobody holds makes the step unclaimable by design — the 403 names the role and the fix. The gate reads the array off the run's pinned definition, not `HumanTask.assignedRole`, which only ever holds `allowedRoles[0]` |

What a human task can *submit back* is a discriminated union in
[`task-completion.ts`](../../packages/platform-core/src/schemas/task-completion.ts):
`verdict`, `params`, `verdict-with-params`, `upload` (pairs with `file-upload`),
`assignment` (item→assignee rows — `assignment-table`), and `rows` (edited table
rows — `table-editor`). The completion kind, not just the component, is what
shapes the step output.

## Scripts — inline vs command

Runtimes and how each is launched are the `RUNTIME_CONFIG` map in
[`script-container-plugin.ts`](../../packages/agent-runtime/src/plugins/script-container-plugin.ts).

| Mode | Set | Image | Runs |
|------|-----|-------|------|
| Inline | `inlineScript` + `runtime` | auto per runtime (override with `image`) | `javascript` (`node`), `python` (`python3`), `r` (`Rscript`), `bash` (`sh`) |
| Command | `command` + `image` (or `dockerfile`+`repo`+`commit`) | the named/built image | any shell command in that image |

Every script reads `/output/input.json` and writes `/output/result.json`. The
working directory is `/workspace` (the per-run git worktree). A third mode is
`plugin: databricks-job`, which requires step-level `databricks`
(`DatabricksJobConfigSchema`) instead of `script`.

**Runtime auto-selection is inline-only.** A `command` can only execute code
already reachable in the container: baked into the image, present at
`/workspace` (via `workspace.remote`), or self-contained (`python3 -c "..."`).
To run a script *file from your package*, copy it into a custom image
(Dockerfile + `repo` + `commit`, which triggers the golden-rules §2 pinning
rules) or mount it through `workspace.remote`. Inline scripts need none of that,
which is why they are the default for small glue.

## Models

Full model IDs come from the OpenRouter-synced registry, populated by
[`sync-models.ts`](../../packages/platform-api/src/handlers/models/sync-models.ts)
and queried with `mediforce model list` / `mediforce model validate` (both need
a deployment + API key). Offline, prefer short Claude aliases (`sonnet`, `opus`,
`haiku`): the `claude-code-agent` plugin passes `--model` straight through, and
the runtime default is `anthropic/claude-sonnet-4`
([`llm-client.ts`](../../packages/agent-runtime/src/runner/llm-client.ts)).

## Agents — autonomy, reliability, review, internet access

Control fields deciding *how supervised* an `agent` step is and *what it may
reach*. All on `WorkflowAgentConfigSchema` / `WorkflowStepSchema` in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts);
the control-mode mapping is golden-rules §5 + [ADR-0014](../adr/0014-control-mode-ui-concept.md)
/ [ADR-0008](../adr/0008-step-executor-model.md). The rows point at the runtime
that *enforces* each one — the behaviour is not visible from the schema.

| Capability | Field | Where the behaviour is defined |
|-----------|-------|-------------------------------|
| Autonomy L0–L4 — silent / shadow / annotate / human-review / autopilot | `autonomyLevel` | [`agent-runner.ts`](../../packages/agent-runtime/src/runner/agent-runner.ts) decides `appliedToWorkflow` + pause/escalate per level |
| Confidence gate | `agent.confidenceThreshold` (0–1) | [`fallback-handler.ts`](../../packages/agent-runtime/src/runner/fallback-handler.ts) |
| What happens below threshold / on failure | `agent.fallbackBehavior` = `escalate_to_human` \| `continue_with_flag` \| `pause` | [`fallback-handler.ts`](../../packages/agent-runtime/src/runner/fallback-handler.ts) |
| Built-in approve/revise loop | `review` (`type`: `human`/`agent`/`none`, `maxIterations`, `timeBoxDays`) + L3 | iteration cap enforced by [`review-tracker.ts`](../../packages/workflow-engine/src/review/review-tracker.ts) + [`workflow-engine.ts`](../../packages/workflow-engine/src/engine/workflow-engine.ts); L3 task creation in [`agent-step-executor.ts`](../../packages/agent-runtime/src/runner/agent-step-executor.ts) |
| **Internet / extra tools** | `agent.allowedTools` | base set is `Bash, Read, Write, Edit, Glob, Grep`; add `WebSearch`/`WebFetch` (or any built-in tool) here — merged in [`claude-code-agent-plugin.ts`](../../packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts) |
| Fail-soft (advance despite a step error) | `continueOnError` — **`action` steps only** | the only runtime branch honouring it is the action-executor catch in [`run/route.ts`](../../packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts): marks the step `failed`, logs a warning + audit entry, advances with `{}`. Agent/script/human/cowork steps ignore it — for `agent`, the equivalent is `fallbackBehavior: continue_with_flag` |

`review.timeBoxDays` is accepted by the schema but **not enforced at runtime** —
only `maxIterations` is checked. Treat it as declarative-only.

Which runtime actually runs an `agent`/`script` step is the registered plugin
(via `step.plugin` / Agent Definition `runtimeId`): `claude-code-agent` is the
default executor, with `opencode-agent`
([`opencode-agent-plugin.ts`](../../packages/agent-runtime/src/plugins/opencode-agent-plugin.ts))
as an alternative, plus `script-container` and `databricks-job` for `script`
steps. All live in [`agent-runtime/src/plugins/`](../../packages/agent-runtime/src/plugins/).

## Tools & MCP governance

A workflow gives an agent external tools by **referencing an Agent Definition**
(`step.agentId`), which carries the canonical MCP server bindings; the step may
only *narrow* them. Tool Catalog entries and Agent Definition bindings are
platform setup (`MANUAL`) — the production checklist is golden-rules §7.

| Capability | Field / schema | Source |
|-----------|----------------|--------|
| Reference a governed agent from a step | `step.agentId` | `WorkflowStepSchema` ([`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts)) |
| Agent's canonical MCP bindings (stdio via `catalogId`, or http with `headers`/`oauth` auth) | `AgentDefinition.mcpServers` | [`agent-definition.ts`](../../packages/platform-core/src/schemas/agent-definition.ts) + [`agent-mcp-binding.ts`](../../packages/platform-core/src/schemas/agent-mcp-binding.ts) |
| Per-step narrowing (subtractive only — `disable` server or `denyTools`) | `step.mcpRestrictions` | `StepMcpRestrictionSchema` ([`agent-mcp-binding.ts`](../../packages/platform-core/src/schemas/agent-mcp-binding.ts)) |
| Admin-curated stdio server catalog | `ToolCatalogEntrySchema` | [`agent-mcp-binding.ts`](../../packages/platform-core/src/schemas/agent-mcp-binding.ts) |
| OAuth providers for http MCP servers | `OAuthProviderConfigSchema` | [`oauth-provider.ts`](../../packages/platform-core/src/schemas/oauth-provider.ts) |
| Inline step-level MCP (**deprecated** — use `agentId`) | `agent.mcpServers` / `cowork.mcpServers` | `McpServerConfigSchema` ([`mcp-server-config.ts`](../../packages/platform-core/src/schemas/mcp-server-config.ts)) |

The effective tool set a step actually gets — agent bindings minus step
restrictions — is computed at runtime by
[`resolve-effective-mcp.ts`](../../packages/platform-core/src/mcp/resolve-effective-mcp.ts)
and [`resolve-mcp-for-step.ts`](../../packages/agent-runtime/src/mcp/resolve-mcp-for-step.ts).

## Notifications

A workflow can push notifications to roles on lifecycle events, via
`notifications[]` on the definition (`ProcessNotificationConfigSchema` in
[`process-config.ts`](../../packages/platform-core/src/schemas/process-config.ts)).

| `event` | Fires when | Dispatch |
|---------|-----------|----------|
| `task_assigned` | a human task is created/assigned | resolved to role members and sent via `NotificationService` ([`notification-service.ts`](../../packages/platform-core/src/interfaces/notification-service.ts)) |
| `agent_escalation` | an agent run escalates to a human | dispatched in [`workflow-engine.ts`](../../packages/workflow-engine/src/engine/workflow-engine.ts) (`getUsersByRoleInNamespace` → `NotificationService.send`, so a role grant narrowed to another workflow is not notified — ADR-0019) |

Channel + address shape is `NotificationTargetSchema` (`email` / `webhook`) in
the same file.

## Cowork — chat & voice-realtime

`WorkflowCoworkConfigSchema` in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).
Beyond "live collaboration" it can extract a **structured artifact** from the
conversation.

| Capability | Field | Notes |
|-----------|-------|-------|
| Mode | `agent` = `chat` \| `voice-realtime` | per-mode config under `chat` / `voiceRealtime` |
| Steer the session | `systemPrompt` | free text |
| Typed artifact out | `outputSchema` (inline JSON Schema) **or** `outputSchemaRef` | `outputSchemaRef: "workflow-definition-authorable"` reuses the WD authorable schema; resolved by `resolveCoworkOutputSchema` in the same file |
| Voice tuning | `voiceRealtime.{voice, model, synthesisModel, maxDurationSeconds, idleTimeoutSeconds}` | only for `voice-realtime` |

`outputSchemaRef` is the mechanism behind the voice/chat **workflow-designer**
apps — the session output is itself a validated WorkflowDefinition.

## Triggers & trigger input

Triggers are **not** declared on the definition. They are independent, mutable
resources on the unified `triggers` table (`TriggerResourceSchema` in
[`trigger.ts`](../../packages/platform-core/src/schemas/trigger.ts)), attached to a
workflow out-of-band and managed via
`mediforce workflow trigger-add|trigger-list|trigger-update|trigger-start|trigger-stop|trigger-remove`,
the UI **Triggers** tab, or `POST /api/workflow-definitions/:name/triggers`. The
`manual` trigger is a per-workflow singleton auto-seeded on register (hand-start
works by default). A cron payload can be supplied with `--payload '<json object>'`
on `trigger-add` / `trigger-update`; it must satisfy the workflow's `triggerInput`
contract. See [ADR-0011](../adr/0011-triggers-detached-unified-resource.md).

`TriggerTypeSchema` has exactly three types, routed the same way regardless of
how they are attached (`event` is reserved for the future — not in the enum, no
router, do not author it):

| `type` | Routed by | Notes |
|--------|-----------|-------|
| `manual` | [`manual-trigger.ts`](../../packages/workflow-engine/src/triggers/manual-trigger.ts) | form values come from `triggerInput`; no transport, so `triggerContext` is empty |
| `webhook` | [`webhook-router.ts`](../../packages/workflow-engine/src/triggers/webhook-router.ts) | typed `method` + `path` (exact match, no globbing) narrowed by `WebhookTriggerConfigSchema`; the JSON body's **top-level keys map 1:1 onto `triggerInput`** and are validated (400 + per-field `details` on mismatch); the remaining HTTP envelope goes to `triggerContext` — credential headers are stripped |
| `cron` | [`cron-trigger.ts`](../../packages/workflow-engine/src/triggers/cron-trigger.ts) | `schedule` cron string; scheduler is deployment-side. An optional static `config.payload` per row is the tick's input, validated at attach time and again at fire time (drift skips the tick with a reason); `schedule`/`firedAt` go to `triggerContext` |

`triggerInput` (`TriggerInputFieldSchema`) is the contract every trigger
validates against, and doubles as the manual-start form. Spawned child runs use
the same contract. Each field has a `type` of `string` / `number` / `boolean` /
`date` / `datetime` / `select` / `multiselect` / `textarea` / `object`, plus
`options` / `default` / `required` (it extends `StepParamSchema`). `object`
holds an opaque JSON object the definition does not enumerate — the way a
proxied third-party body enters a run; the Start Run form renders it as a JSON
textarea. Validation is **total and always on**: undeclared fields are a hard
error, and an empty/absent `triggerInput` means the payload must be empty.

A field's `default` belongs to the contract, not the form: `validatePayload`
fills it in for every field a firing omitted (`undefined` / `null` — a supplied
`false` / `0` / `''` survives) and the manual, webhook, cron and `spawn` paths
all fire with that resolved payload, so a `required` field with a `default` is
satisfiable by a cron row carrying no payload. Defaults are type-checked like
any other value. See
[`payload-validator.ts`](../../packages/platform-core/src/validation/payload-validator.ts)
and the field-by-field tour in
[`07-trigger-varieties.wd.json`](../workflow-examples/07-trigger-varieties.wd.json).

## Workflow-level fields (the envelope)

Beyond `steps` / `transitions`, on `WorkflowDefinitionBaseSchema` in
[`workflow-definition.ts`](../../packages/platform-core/src/schemas/workflow-definition.ts).

| Capability | Field | Notes |
|-----------|-------|-------|
| Listing visibility | `visibility` = `public` \| `private` (default `private`) | `WorkflowVisibilitySchema` |
| Declared roles | `roles` | role names used by `allowedRoles` / `assignedTo` / notifications |
| Run-wide / per-step config | `env` (workflow + step level) | non-secret config; values may reference `{{SECRET_NAME}}` |
| Agent context preamble | `preamble` | prepended context for agent steps |
| Git-import provenance (no runtime effect) | `source` (`WorkflowSourceSchema`, `{url, path, commit}`) | informational only — see [ADR-0009](../adr/0009-workflow-import-scope-boundary.md) |
| Copy lineage | `copiedFrom` | namespace/name/version this WD was duplicated from |
| Shared `/workspace` git worktree per run | `workspace.remote` (`WorkflowWorkspaceSchema`) | one worktree on branch `run/<runId>`, mounted into every step; committed per-step, never pushed |
| Carry values into the next run | `inputForNextRun` → `/output/previous_run.json` | golden-rules §8 |

The authorable surface (what the design LLM may emit) is `WorkflowAuthorableSchema`
in the same file — server-managed and lifecycle fields are excluded by construction.
