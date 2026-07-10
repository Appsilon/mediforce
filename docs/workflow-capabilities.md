# Workflow capabilities

What a Mediforce workflow can actually do, mapped to the **source files** that
define and run each capability. Read this before deciding something is
impossible — most "you can't do that" answers are wrong because the capability
lives in code the reader never opened.

This file is a **map, not a spec**. It deliberately does not restate field rules
or copy schema prose (that forks the source of truth). Each row points at the
authoritative file; open it when you need the exact shape. The production
checklist is [`workflow-authoring-golden-rules.md`](workflow-authoring-golden-rules.md);
schema-by-example lives in [`workflow-examples/`](workflow-examples/README.md).

## How to use this when authoring

1. Skim the capability tables below so you know what exists.
2. For any capability you are about to use, open its **Source** file and read
   the real schema / handler — do not author from this summary alone.
3. Cite the source file when you tell a user something is or isn't possible.

## Executors — what a step can be

The executor enum and per-executor config are in
[`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts);
the model is [ADR-0008](adr/0008-step-executor-model.md), control modes are
[ADR-0006](adr/0006-control-mode-ui-concept.md). The canonical use table is
golden-rules §5 — do not duplicate it here.

| Executor | Capability headline | Source |
|----------|--------------------|--------|
| `human` | Forms, approvals, classification, table editing; can be pre-assigned to a user | `WorkflowStepSchema` (`ui`, `params`, `verdicts`, `selection`, `assignedTo`) |
| `agent` | LLM judgment/synthesis; CM3 approve-revise loop (`autonomyLevel`) | `WorkflowAgentConfigSchema` |
| `script` | Deterministic code — inline or command, four runtimes | `ScriptStepConfigSchema` + [`script-container-plugin.ts`](../packages/agent-runtime/src/plugins/script-container-plugin.ts) |
| `cowork` | Live human-agent chat or voice-realtime collaboration | `WorkflowCoworkConfigSchema` |
| `action` | Built-in side effects (see below) | `ActionConfigSchema` |

## Actions — built-in side effects (this is where fan-out lives)

Action `kind` is a discriminated union in `ActionConfigSchema`
([`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts));
each kind is dispatched by [`registry.ts`](../packages/core-actions/src/registry.ts)
to a handler in [`core-actions/src/handlers/`](../packages/core-actions/src/handlers/).

| `kind` | What it does | Config schema |
|--------|--------------|---------------|
| `http` | Outbound HTTP request, templated url/body/headers | `HttpActionConfigSchema` |
| `reshape` | Pure data transform — rebuild an object from interpolated leaves | `ReshapeActionConfigSchema` |
| `email` | Send email (Mailgun/SMTP; disabled when `MEDIFORCE_DISABLE_EMAIL=true`) | `EmailActionConfigSchema` |
| `spawn` | Launch child workflow(s); **`forEach` fans out one child per item** | `SpawnActionConfigSchema` |
| `wait` | Pause until a `duration`, a `deadline`, or a `condition` | `WaitActionConfigSchema` |

**Fan-out** (the "spawn a workflow per team member" pattern) is
`action.kind: spawn` with `forEach: "${steps.x.list}"` and a single `targets`
template using `${item.*}`. End-to-end working example:
[`apps/team-pulse/src/team-pulse.wd.json`](../apps/team-pulse/src/team-pulse.wd.json)
(`spawn_perspectives` → `wait` → `collect_responses`), distilled in
[`workflow-examples/11-fan-out-orchestration.wd.json`](workflow-examples/11-fan-out-orchestration.wd.json).

Handler nuances not visible in the schema (in
[`core-actions/src/handlers/`](../packages/core-actions/src/handlers/)):
- `spawn` fan-out is **capped at 50 children per step execution**
  ([`spawn.ts`](../packages/core-actions/src/handlers/spawn.ts)); `continueOnSpawnError`
  (default `true`) decides whether one failed child aborts the action.
- `email` supports `cc` / `bcc` / `replyTo` / `html` and is **rate-limited**
  (default 50/run, 30/minute) in [`email.ts`](../packages/core-actions/src/handlers/email.ts).
- `http` never throws on a non-2xx response — it returns `{ status, headers, body }`;
  only transport failures throw ([`http.ts`](../packages/core-actions/src/handlers/http.ts)).
- `wait` `condition` is stored on the pause sentinel but **not polled** by the
  handler ([`wait.ts`](../packages/core-actions/src/handlers/wait.ts)) — see the note above.

## Two expression languages — do not mix them

| Use site | Syntax | Roots available | Source |
|----------|--------|-----------------|--------|
| Transition `when` | bare, no `${}`: `verdict == "x"`, `output.f > 1`, `&&`, `\|\|`, `!` | `output`, `variables`, `verdict` | [`expression-evaluator.ts`](../packages/workflow-engine/src/expressions/expression-evaluator.ts) |
| Action configs, `spawn` payloads, `assignedTo`, step `env`, http body | `${...}` templates with dot/index paths | `steps`, `item` (in `forEach`), `triggerPayload`, `variables`, `secrets` | [`interpolation.ts`](../packages/platform-core/src/interpolation.ts) |

Notes that trip people up:
- A manual trigger's `triggerInput` form values arrive at runtime as
  `${triggerPayload.*}`, not `${triggerInput.*}`.
- `${steps.<id>.<path>}` reads a previous step's output; `getPath` supports
  `a.b`, `a.0.x`, and `a[0].x`, and returns empty for missing paths.
- `${secrets.NAME}` resolves in any action config field (never in transition
  `when` or human-step config). The runner passes `secrets` into every action
  dispatch ([`run/route.ts`](../packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts) —
  `sources.secrets`), so a secret is **not** automatically scrubbed from output:
  handlers that echo their interpolated config persist it. `reshape` returns its
  interpolated `values` as the step output
  ([`reshape.ts`](../packages/core-actions/src/handlers/reshape.ts)), and `email`
  writes back interpolated `to`/`subject`
  ([`email.ts`](../packages/core-actions/src/handlers/email.ts)). Keep
  `${secrets.*}` in fields that are not echoed — `http` url/headers/body (only the
  *response* is stored) and `email` `body`/`html` — not in `reshape` values or
  `email` `to`/`subject`.

## Human steps — richer than "a form"

All on `WorkflowStepSchema` in
[`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts);
shared sub-schemas (`StepUiSchema`, `StepParamSchema`, `VerdictSchema`,
`SelectionSchema`) live in `process-definition.ts`.

| Capability | Field | Notes |
|-----------|-------|-------|
| Custom UI component | `ui.component` + `ui.config` | Resolved by [`task-body-registry.tsx`](../packages/platform-ui/src/components/tasks/task-body-registry.tsx); registered ids are `file-upload`, `assignment-table`, `table-editor` (each renders its own view). `table-editor` columns support a `kind` (e.g. `avatar`). Unknown ids fall back to the params/verdict/selection views |
| Collected inputs | `params` | `StepParamSchema` fields: `type` (widget hint — `textarea`, `multiselect`, … falling back to text), `options` (dropdown), `default`, `required`, and `requiredForVerdicts` (required only for named verdicts) |
| Business verdicts | `verdicts` | `VerdictSchema`: `target` + `label`, `intent` (`success`/`danger`/`warning`/`neutral`), `requiresComment`. Defaults filled by [`verdicts.ts`](../packages/platform-core/src/schemas/verdicts.ts). Routed by transition `when: verdict == "..."` |
| Pick from a list | `selection` | `SelectionSchema`: a number (exact count) or `{ min, max }` range |
| **Dynamic assignee** | `assignedTo` | `${...}`-interpolated user id; only valid on `executor: human`; the engine resolves it and marks the task `claimed` — [`workflow-engine.ts`](../packages/workflow-engine/src/engine/workflow-engine.ts) |
| Role gating | `allowedRoles` | Restrict who can act |

What a human task can *submit back* is a discriminated union in
[`task-completion.ts`](../packages/platform-core/src/schemas/task-completion.ts):
`verdict`, `params`, `verdict-with-params`, `upload` (file attachments — pairs
with the `file-upload` component), `assignment` (item→assignee rows — pairs with
`assignment-table`), and `rows` (edited table rows — pairs with `table-editor`).
The completion kind, not just the component, is what shapes the step output.

## Scripts — inline vs command

Runtimes and how each is launched are the `RUNTIME_CONFIG` map in
[`script-container-plugin.ts`](../packages/agent-runtime/src/plugins/script-container-plugin.ts).

| Mode | Set | Image | Runs |
|------|-----|-------|------|
| Inline | `inlineScript` + `runtime` | auto per runtime (override with `image`) | `javascript` (`node`), `python` (`python3`), `r` (`Rscript`), `bash` (`sh`) |
| Command | `command` + `image` (or `dockerfile`+`repo`+`commit`) | the named/built image | any shell command in that image |

Every script reads `/output/input.json` and writes `/output/result.json`. The
working directory is `/workspace` (the per-run git worktree).

**Command mode has no runtime auto-selection** — that is inline-only. A
`command` can only execute code that is already reachable in the container:
baked into the image, present at `/workspace` (via `workspace.remote`), or
self-contained (`python3 -c "..."`). To run a script **file from your package**
via `command`, copy it into a custom image (Dockerfile + `repo` + `commit`,
which triggers the §2 pinning rules) or mount it through `workspace.remote`.
Inline scripts need none of that, which is why they are the default for small
glue — see golden-rules for the "move substantial code into pinned files"
threshold.

## Models

Full model IDs come from the OpenRouter-synced registry (a deployment + API key
are required to query it — `mediforce model list` / `mediforce model validate`
hit the platform). Offline, prefer short Claude aliases (`sonnet`, `opus`,
`haiku`): the `claude-code-agent` plugin passes `--model` straight through, and
the runtime default is `anthropic/claude-sonnet-4`
([`llm-client.ts`](../packages/agent-runtime/src/runner/llm-client.ts)). The
OpenRouter sync that populates the registry is
[`sync-models.ts`](../packages/platform-api/src/handlers/models/sync-models.ts).

## Agents — autonomy, reliability, review, internet access

The executor table headlines the `agent` executor; these are the control fields
that decide *how supervised* the agent is and *what it may reach*. All fields are
on `WorkflowAgentConfigSchema` / `WorkflowStepSchema` in
[`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts);
the control-mode mapping is golden-rules §5 + [ADR-0006](adr/0006-control-mode-ui-concept.md)
/ [ADR-0008](adr/0008-step-executor-model.md). The rows below point at the
runtime that *enforces* each one — the behaviour is not visible from the schema.

| Capability | Field | Where the behaviour is defined |
|-----------|-------|-------------------------------|
| Autonomy L0–L4 — silent / shadow / annotate / human-review / autopilot | `autonomyLevel` | [`agent-runner.ts`](../packages/agent-runtime/src/runner/agent-runner.ts) decides `appliedToWorkflow` + pause/escalate per level |
| Confidence gate | `agent.confidenceThreshold` (0–1) | [`fallback-handler.ts`](../packages/agent-runtime/src/runner/fallback-handler.ts) |
| What happens below threshold / on failure | `agent.fallbackBehavior` = `escalate_to_human` \| `continue_with_flag` \| `pause` | [`fallback-handler.ts`](../packages/agent-runtime/src/runner/fallback-handler.ts) |
| Built-in approve/revise loop | `review` (`type`: `human`/`agent`/`none`, `maxIterations`, `timeBoxDays`) + L3 | iteration cap enforced by [`review-tracker.ts`](../packages/workflow-engine/src/review/review-tracker.ts) + [`workflow-engine.ts`](../packages/workflow-engine/src/engine/workflow-engine.ts); L3 task creation in [`agent-step-executor.ts`](../packages/agent-runtime/src/runner/agent-step-executor.ts) |
| **Internet / extra tools** | `agent.allowedTools` | base set is `Bash, Read, Write, Edit, Glob, Grep`; add `WebSearch`/`WebFetch` (or any built-in tool) here — merged in [`claude-code-agent-plugin.ts`](../packages/agent-runtime/src/plugins/claude-code-agent-plugin.ts) |
| Fail-soft (advance despite a step error) | `continueOnError` — **`action` steps only** | the only runtime branch that honours it is the action-executor catch ([`run/route.ts`](../packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts), `currentStep.continueOnError === true`): it marks the step `failed`, logs a warning + audit entry, and advances with `{}`. Agent/script/human/cowork steps ignore the flag — for an `agent` step the equivalent is `fallbackBehavior` (`continue_with_flag`) |

`review.timeBoxDays` is accepted by the schema but **not enforced at runtime** —
only `maxIterations` is checked. `wait` action `condition` is likewise stored
but not polled. Treat both as declarative-only until the runtime catches up.

Which runtime actually runs an `agent`/`script` step is the registered plugin
(via `step.plugin` / Agent Definition `runtimeId`): `claude-code-agent` is the
default executor, with `opencode-agent`
([`opencode-agent-plugin.ts`](../packages/agent-runtime/src/plugins/opencode-agent-plugin.ts))
as an alternative, plus `script-container` and `databricks-job` for `script`
steps. All live in [`agent-runtime/src/plugins/`](../packages/agent-runtime/src/plugins/).

## Tools & MCP governance

A workflow gives an agent external tools by **referencing an Agent Definition**
(`step.agentId`), which carries the canonical MCP server bindings; the step may
only *narrow* them. Tool Catalog entries and Agent Definition bindings are
platform setup (`MANUAL`) — the production checklist is golden-rules §7. This is
the source map for the schemas behind it.

| Capability | Field / schema | Source |
|-----------|----------------|--------|
| Reference a governed agent from a step | `step.agentId` | `WorkflowStepSchema` ([`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts)) |
| Agent's canonical MCP bindings (stdio via `catalogId`, or http with `headers`/`oauth` auth) | `AgentDefinition.mcpServers` | [`agent-definition.ts`](../packages/platform-core/src/schemas/agent-definition.ts) + [`agent-mcp-binding.ts`](../packages/platform-core/src/schemas/agent-mcp-binding.ts) |
| Per-step narrowing (subtractive only — `disable` server or `denyTools`) | `step.mcpRestrictions` | `StepMcpRestrictionSchema` ([`agent-mcp-binding.ts`](../packages/platform-core/src/schemas/agent-mcp-binding.ts)) |
| Admin-curated stdio server catalog | `ToolCatalogEntrySchema` | [`agent-mcp-binding.ts`](../packages/platform-core/src/schemas/agent-mcp-binding.ts) |
| OAuth providers for http MCP servers | `OAuthProviderConfigSchema` | [`oauth-provider.ts`](../packages/platform-core/src/schemas/oauth-provider.ts) |
| Inline step-level MCP (**deprecated** — use `agentId`) | `agent.mcpServers` / `cowork.mcpServers` | `McpServerConfigSchema` ([`mcp-server-config.ts`](../packages/platform-core/src/schemas/mcp-server-config.ts)) |

The effective tool set a step actually gets is computed at runtime — agent
bindings minus step restrictions — by
[`resolve-effective-mcp.ts`](../packages/platform-core/src/mcp/resolve-effective-mcp.ts)
and [`resolve-mcp-for-step.ts`](../packages/agent-runtime/src/mcp/resolve-mcp-for-step.ts).

## Notifications

A workflow can push notifications to roles on lifecycle events. Config schema is
`ProcessNotificationConfigSchema`
([`process-config.ts`](../packages/platform-core/src/schemas/process-config.ts));
the field is `notifications[]` on the workflow definition.

| `event` | Fires when | Dispatch |
|---------|-----------|----------|
| `task_assigned` | a human task is created/assigned | resolved to role members and sent via `NotificationService` ([`notification-service.ts`](../packages/platform-core/src/interfaces/notification-service.ts)) |
| `agent_escalation` | an agent run escalates to a human | dispatched in [`workflow-engine.ts`](../packages/workflow-engine/src/engine/workflow-engine.ts) (`getUsersByRole` → `NotificationService.send`) |

Channel + address shape is `NotificationTargetSchema` (`email` / `webhook`) in
the same file.

## Cowork — chat & voice-realtime

The executor table headlines `cowork`; the config is `WorkflowCoworkConfigSchema`
in [`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts).
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

Trigger shapes are `TriggerSchema`
([`process-definition.ts`](../packages/platform-core/src/schemas/process-definition.ts));
webhook config is narrowed by `WebhookTriggerConfigSchema`
([`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts)).
Worked example: [`workflow-examples/07-trigger-varieties.wd.json`](workflow-examples/07-trigger-varieties.wd.json).

| `type` | Routed by | Notes |
|--------|-----------|-------|
| `manual` | [`manual-trigger.ts`](../packages/workflow-engine/src/triggers/manual-trigger.ts) | form values come from `triggerInput`; arrive at runtime as `${triggerPayload.*}` |
| `webhook` | [`webhook-router.ts`](../packages/workflow-engine/src/triggers/webhook-router.ts) | typed `method` + `path` (exact match, no globbing); payload is `{ body, headers, query, method, path }` |
| `cron` | [`cron-trigger.ts`](../packages/workflow-engine/src/triggers/cron-trigger.ts) | `schedule` cron string; scheduler is deployment-side |
| `event` | — | **in the enum but has no router** ([`triggers/`](../packages/workflow-engine/src/triggers/) has only manual/webhook/cron) — treat as not yet implemented |

Manual-start form fields are `triggerInput` (`TriggerInputFieldSchema`): each has
a `type` of `string` / `number` / `boolean` / `date` / `datetime` / `select` /
`multiselect` / `textarea`, plus `options` / `default` / `required` (it extends
`StepParamSchema`).

## Workflow-level fields (the envelope)

Beyond `steps` / `transitions` / `triggers`, the workflow envelope carries config
that applies to the whole definition. All on `WorkflowDefinitionBaseSchema` in
[`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts).

| Capability | Field | Notes |
|-----------|-------|-------|
| Listing visibility | `visibility` = `public` \| `private` (default `private`) | `WorkflowVisibilitySchema` |
| Declared roles | `roles` | role names used by `allowedRoles` / `assignedTo` / notifications |
| Run-wide / per-step config | `env` (workflow + step level) | non-secret config; values may reference `{{SECRET_NAME}}` |
| Agent context preamble | `preamble` | prepended context for agent steps |
| Git-import provenance (no runtime effect) | `source` (`WorkflowSourceSchema`, `{url, path, commit}`) | informational only — see [ADR-0009](adr/0009-workflow-import-scope-boundary.md) |
| Copy lineage | `copiedFrom` | namespace/name/version this WD was duplicated from |

The authorable surface (what the design LLM may emit) is `WorkflowAuthorableSchema`
in the same file — server-managed and lifecycle fields are excluded by construction.

## Per-run git workspace, carry-over, Databricks

| Capability | Field / schema | Source |
|-----------|----------------|--------|
| Shared `/workspace` git worktree per run | `workspace.remote` (`WorkflowWorkspaceSchema`) | [`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts) |
| Carry values into the next run | `inputForNextRun` → `/output/previous_run.json` | golden-rules §8 |
| Databricks job step | `databricks` (`DatabricksJobConfigSchema`) | [`workflow-definition.ts`](../packages/platform-core/src/schemas/workflow-definition.ts) |
