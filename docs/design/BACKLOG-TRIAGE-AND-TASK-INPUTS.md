# Backlog Triage Workflow + `HumanTask.inputs` Refactor

## Context

Workflow `backlog-triage` fetches open GitHub issues, has an LLM propose initial
assignments to humans or AI workflows, lets a person edit assignments in a UI,
then dispatches: assigns humans on GitHub, spawns Mediforce child workflows for
AI assignments, and reports links to spawned runs.

The workflow is the driver for a small platform refactor: introducing
`HumanTask.inputs` as the canonical "task input data" field, replacing the leaky
`options` convention with something each task kind can shape to its needs.

This spec is self-contained. An agent should be able to implement it without
re-reading the prior conversation.

## Goals

1. Refactor the human-task data model: add `inputs: Record<string, unknown>` as
   the dynamic input field, copied from previous step output by the engine.
   Keep `options` working via back-compat alias.
2. Build a new human-task UI kind: `assignment-table` — a many-to-one assignment
   component that renders a table of items, lets the user pick an assignee per
   item from a typed list, plus per-row priority and note.
3. Build the `backlog-triage` workflow under `apps/backlog-triage/` with five
   steps (fetch → propose → assign → dispatch → report) using existing
   `executor: script` + `executor: agent` + `executor: human` primitives.
4. Journey test that exercises the full workflow with mocked GitHub API and
   mocked Mediforce process-start API.

## Non-goals

- No interactive iframe / `interactive-artifact` component. That was an earlier
  design direction; we explicitly pivoted to a native React component. The
  iframe substrate stays a future option, triggered by a workflow that needs
  truly ad-hoc HTML (e.g., one-shot data exploration).
- No idempotency check for re-running the workflow on the same repo.
- No GitHub comment / assignee bookkeeping for AI assignments in MVP.
- No spawning of children with continuation back into the parent workflow. The
  parent ends with a static report of spawned-run links; results of children
  are not awaited or summarized.

## Open assumption (call out in PR description)

The workflow expects child workflows identified by ID in trigger param
`agentWorkflows` to exist on the Mediforce instance and to accept
`issueNumber` as the only required parameter. The journey test mocks the
process-start HTTP endpoint and verifies the call shape; it does not register
real child workflow definitions. If `fullstack-on-issue` (or similar) does
not exist on a target Mediforce instance, dispatch will fail at runtime for
those assignments. Acceptable for MVP.

---

## Part 1 — `HumanTask.inputs` refactor

### Why

Today `HumanTask` passes data to the UI via three mechanisms:

- `task.options: Record<string, unknown>[]` — populated by engine when next
  step has `selection`, intended for "pick N from list" UI
- `task.params: StepParam[]` — copied from step def, used by params-form
- `task.ui.config: Record<string, unknown>` — static config from step def

`options` is leaky: its name forces "selection" semantics on every new task
kind that needs richer inputs. `assignment-table` needs both a list of items
(issues) and a list of assignees (people + workflow IDs) and possibly more
static config. Today you would have to either pack everything into `options[i]`
(duplicating shared data per row) or fetch process-instance variables from
the UI (hidden coupling).

The refactor: add `inputs: Record<string, unknown>` as a free-form dynamic
input bag. Each task kind (discriminated by `ui.component`) declares in code
what shape it expects in `inputs`. Engine copies previous step output's
`inputs` field verbatim into the task.

### Schema changes

`packages/platform-core/src/schemas/human-task.ts`:

```ts
export const HumanTaskSchema = z.object({
  // ... existing fields ...
  inputs: z.record(z.string(), z.unknown()).optional(),
  options: z.array(z.record(z.string(), z.unknown())).optional(), // @deprecated — see migration below
  // ... rest ...
});
```

Add a JSDoc comment on `options` noting it is deprecated and that new task
kinds should put their data in `inputs`. Keep the field; do not remove yet.

### Engine changes

`packages/workflow-engine/src/engine/workflow-engine.ts:266-280`:

Current behavior (paraphrased):

```ts
if (nextStep.selection !== undefined) {
  selectionFields.selection = nextStep.selection;
  const prevOutput = updatedInstance.variables[instance.currentStepId!];
  const rawOptions = prevOutput?.options;
  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    // validate against selection.min
    selectionFields.options = rawOptions;
  }
}
```

New behavior:

```ts
const prevOutput = updatedInstance.variables[instance.currentStepId!] as
  | Record<string, unknown>
  | undefined;

// New: copy `inputs` from previous step output verbatim.
const inputs = (prevOutput?.inputs as Record<string, unknown> | undefined) ?? undefined;

// Back-compat: if step has `selection`, populate `options` from
// (a) prevOutput.inputs.options (new convention), or
// (b) prevOutput.options (legacy convention).
if (nextStep.selection !== undefined) {
  selectionFields.selection = nextStep.selection;
  const inputsOptions = (inputs?.options as Record<string, unknown>[] | undefined);
  const legacyOptions = prevOutput?.options as Record<string, unknown>[] | undefined;
  const rawOptions = inputsOptions ?? legacyOptions;
  if (Array.isArray(rawOptions) && rawOptions.length > 0) {
    const { min } = normalizeSelection(nextStep.selection);
    if (rawOptions.length < min) {
      throw new Error(/* same message as today */);
    }
    selectionFields.options = rawOptions;
  }
}

const task: HumanTask = {
  // ... existing fields ...
  ...(inputs ? { inputs } : {}),
  ...selectionFields,
};
```

Engine does not interpret `inputs`. Each component is responsible for reading
its own shape.

### DTO / API changes

`packages/platform-api`: any DTO that returns a `HumanTask` to the frontend
must include `inputs` in its serialized form. Find every place that maps
`HumanTask → response` and add the field. Zod parser on the client side
must also accept it.

### Firestore mapper

`packages/platform-infra`: when reading existing tasks from Firestore that
predate this change, ensure backward compatibility. If a task has `options`
but no `inputs`, return it as-is; if it has `inputs`, return that too.
No backfill of historic documents.

### UI migration

`packages/platform-ui/src/components/tasks/selection-form.tsx`: read from
`task.inputs?.options ?? task.options`. Add a regression test that confirms
both shapes work.

After this refactor lands, downstream PRs migrate other usages and eventually
drop `options` from the schema. Out of scope here.

### Tests

- `packages/platform-core` unit test for the schema accepting both `options`
  and `inputs`.
- `packages/workflow-engine` engine test: previous step output `{inputs: {x:1}}`
  → task has `inputs: {x:1}`.
- `packages/workflow-engine` engine test: previous step output `{options: [...]}`
  (legacy) with `selection` on next step → task has `options` populated as
  before. No regression.
- `packages/workflow-engine` engine test: previous step output
  `{inputs: {options: [...]}}` with `selection` on next step → task has
  `options` populated from `inputs.options`.
- `packages/platform-ui` regression test for selection-form reading both
  shapes.

---

## Part 2 — `assignment-table` component

### What it does

Renders a table where each row is an item to be assigned. For each row the
user picks:

- `assigneeId` (from a dropdown of allowed assignees + a "skip" option)
- `priority` (from a dropdown of allowed priorities)
- `note` (free text, optional)

The component pre-fills suggested values from each item's `suggestion` field
if present (produced by the previous step). On submit, items where the user
chose "skip" are omitted from `assignments[]` and listed in `skipped[]`.

### Input contract

`task.inputs` shape that the component expects:

```ts
{
  items: Array<{
    id: string;                   // unique key for the row
    label: string;                // primary display text
    sublabel?: string;            // secondary display text
    href?: string;                // optional link out (e.g., GitHub URL)
    badges?: string[];            // optional tag chips (labels, status)
    currentAssignee?: string;     // optional, shown grayed if present
    suggestion?: {
      assigneeId: string;
      priority?: string;
      note?: string;
    };
    raw?: Record<string, unknown>; // anything else passed through to completion
  }>;
  assignees: Array<{
    id: string;
    label: string;                // display name
    kind: 'human' | 'agent';      // shown as icon/badge
    role?: string;                // optional sub-line ("fullstack", "product-owner")
  }>;
}
```

`task.ui.config` shape that the component expects:

```ts
{
  priorities?: string[];            // default ['P0','P1','P2','P3']
  defaultPriority?: string;         // default 'P2'
  noteField?: boolean;              // default true
  allowSkip?: boolean;              // default true
  submitLabel?: string;             // default 'Submit'
  itemColumnLabel?: string;         // default 'Item'
}
```

### Output contract

On submit, `completionData` is:

```ts
{
  assignments: Array<{
    itemId: string;
    assigneeId: string;
    assigneeKind: 'human' | 'agent';
    priority: string;
    note?: string;
    raw?: Record<string, unknown>; // pass-through from input items[i].raw
  }>;
  skipped: string[];                // itemIds the user did not assign
}
```

### Files

- New: `packages/platform-ui/src/components/tasks/assignment-table.tsx`
- New: `packages/platform-ui/src/components/tasks/__tests__/assignment-table.test.tsx`
- New: `packages/platform-ui/src/components/tasks/component-registry.ts` —
  central map from `ui.component` name to React component. Initial entries:
  `'file-upload': FileUploadZone`, `'assignment-table': AssignmentTable`.
- Modified: `packages/platform-ui/src/components/tasks/task-detail.tsx` —
  replace the hardcoded `isFileUploadTask` check with a lookup in
  `component-registry.ts`. Fall back to default form if no component matches.

### Component behavior

- Validates that every `item.suggestion.assigneeId` is in the `assignees[]`
  list. If not, render the row with an empty dropdown + a warning chip
  ("suggestion '<id>' not in allowlist").
- Validates on submit: every assignment's `assigneeId` must be in
  `assignees[]`. Skip rows are excluded.
- Renders `kind` as an icon/badge next to assignee name so the human can see
  if they're delegating to a person or an AI workflow.
- Sortable by suggestion priority (P0 first) by default. No multi-sort.
- Empty state: when `items[]` is empty, show "No items to assign" and disable
  submit.

### Tests

- Renders rows from `task.inputs.items`.
- Pre-fills assignee/priority from `item.suggestion`.
- Submit produces correct `completionData` shape.
- Skipped items go into `skipped[]`, not `assignments[]`.
- Validates suggestion against allowlist.
- Empty items renders correctly.
- Reads from `task.inputs.items` (new contract) — no fallback to `task.options`,
  this is a new component.

---

## Part 3 — `backlog-triage` workflow

### Directory layout

```
apps/backlog-triage/
  src/
    process-definition.yaml
  scripts/
    fetch.py
    dispatch.py
  prompts/
    propose-assignments.md           # system prompt for the LLM step
  __tests__/
    backlog-triage.journey.test.ts
  package.json
```

### `process-definition.yaml`

```yaml
name: backlog-triage
version: "1"
description: >
  Fetches open GitHub issues, has an LLM propose initial assignments to humans
  or AI workflows, lets a person edit assignments in a table, then assigns
  humans on GitHub and spawns Mediforce workflows for AI delegations.

triggers:
  - name: manual
    type: manual
    config:
      params:
        - name: repo
          type: string
          required: true
          description: "owner/repo, e.g. appsilon/mediforce"
        - name: labelFilter
          type: string
          required: false
          description: "Optional comma-separated label filter"
        - name: members
          type: string
          required: false
          default: "filip[fullstack],marek[product-owner],marcin[fullstack],maria[product],pawel[fullstack],vedha[fullstack]"
          description: >
            CSV in 'name[role]' format. Role is hint context for the LLM.
        - name: agentWorkflows
          type: string
          required: false
          default: "fullstack-on-issue"
          description: >
            CSV of Mediforce workflow IDs. Each must accept `issueNumber` as
            its only required parameter; other params must have defaults.

steps:
  - id: fetch-backlog
    name: Fetch backlog
    type: creation
    executor: script
    plugin: script-container
    agentConfig:
      runtime: python
      command: "python scripts/fetch.py"
    # Reads trigger params from env (Mediforce convention).
    # Reads GITHUB_TOKEN from workflow secrets.
    # Writes its output (see contract below) to stdout as JSON.

  - id: propose-assignments
    name: Propose initial assignments
    type: creation
    executor: agent
    agentConfig:
      prompt: |
        @prompts/propose-assignments.md
      # Reads previous step output from input.
      # Returns JSON matching the `inputs` envelope contract (see below).

  - id: assign
    name: Assign
    type: creation
    executor: human
    ui:
      component: assignment-table
      config:
        priorities: [P0, P1, P2, P3]
        defaultPriority: P2
        allowSkip: true
        submitLabel: Confirm
        itemColumnLabel: Issue

  - id: dispatch
    name: Dispatch to assignees
    type: creation
    executor: script
    plugin: script-container
    agentConfig:
      runtime: python
      command: "python scripts/dispatch.py"
    # Reads completionData of `assign` step.
    # Reads GITHUB_TOKEN and MEDIFORCE_API_KEY from workflow secrets.
    # MEDIFORCE_BASE_URL defaults to the parent instance's base URL.

  - id: report
    name: Report
    type: terminal

transitions:
  - from: fetch-backlog
    to: propose-assignments
  - from: propose-assignments
    to: assign
  - from: assign
    to: dispatch
  - from: dispatch
    to: report

secrets:
  - GITHUB_TOKEN
  - MEDIFORCE_API_KEY
```

### Step output contracts

**`fetch-backlog` (stdout JSON):**

```json
{
  "issues": [
    {
      "number": 123,
      "title": "Add CSV export",
      "body": "...",
      "labels": ["enhancement"],
      "currentAssignee": "marek",
      "url": "https://github.com/owner/repo/issues/123"
    }
  ],
  "members": [
    { "id": "filip", "role": "fullstack" },
    { "id": "marek", "role": "product-owner" }
  ],
  "agentWorkflows": [
    { "id": "fullstack-on-issue" }
  ]
}
```

The script parses `members` CSV (`"name[role],..."`) and `agentWorkflows` CSV
into structured arrays. Fetches open issues from GitHub via REST API
(`/repos/{owner}/{repo}/issues?state=open&labels={filter}`). Returns the
envelope above.

**`propose-assignments` (output / `instance.variables`):**

```json
{
  "inputs": {
    "items": [
      {
        "id": "123",
        "label": "#123 Add CSV export",
        "sublabel": "enhancement",
        "href": "https://github.com/owner/repo/issues/123",
        "badges": ["enhancement"],
        "currentAssignee": "marek",
        "suggestion": {
          "assigneeId": "filip",
          "priority": "P1",
          "note": "JSON serialization is in filip's PRs recently"
        },
        "raw": {
          "issueNumber": 123,
          "title": "Add CSV export"
        }
      }
    ],
    "assignees": [
      { "id": "filip", "label": "Filip", "kind": "human", "role": "fullstack" },
      { "id": "marek", "label": "Marek", "kind": "human", "role": "product-owner" },
      { "id": "fullstack-on-issue", "label": "Fullstack agent", "kind": "agent" }
    ]
  }
}
```

The LLM is prompted with the `fetch-backlog` output and a system prompt
(see `prompts/propose-assignments.md`) that instructs it to return exactly
this shape. Output is validated by a Zod schema at the engine boundary;
malformed output fails the step.

Engine then copies `inputs` into `task.inputs` per Part 1.

**`assign` completionData** (component output, see Part 2):

```json
{
  "assignments": [
    {
      "itemId": "123",
      "assigneeId": "filip",
      "assigneeKind": "human",
      "priority": "P1",
      "note": "..." ,
      "raw": { "issueNumber": 123, "title": "Add CSV export" }
    }
  ],
  "skipped": ["456", "789"]
}
```

**`dispatch` (stdout JSON):**

For each assignment, dispatches according to `assigneeKind`:

- `human` → GitHub: `PATCH /repos/{owner}/{repo}/issues/{number}` with
  `{ assignees: [assigneeId], labels: [...existingLabels, "priority/<P>"] }`.
  Errors are logged into the output `errors[]` array; the script does not
  fail the step on per-assignment errors (continue-on-error within the
  script, not via `step.continueOnError`).
- `agent` → Mediforce: `POST {MEDIFORCE_BASE_URL}/api/processes` with
  `{ workflowId: assigneeId, params: { issueNumber: raw.issueNumber } }`,
  auth via `X-Api-Key: $MEDIFORCE_API_KEY`. Records returned `runId` and
  URL.

Sequential, not concurrent. One failure does not stop the rest.

Output:

```json
{
  "humanAssignments": [
    { "issueNumber": 123, "assignee": "filip", "priority": "P1" }
  ],
  "agentRuns": [
    {
      "issueNumber": 200,
      "workflowId": "fullstack-on-issue",
      "runId": "abc123",
      "url": "https://mediforce.app/runs/abc123"
    }
  ],
  "skipped": [
    { "issueNumber": 456 },
    { "issueNumber": 789 }
  ],
  "errors": [
    {
      "issueNumber": 200,
      "assigneeId": "fullstack-on-issue",
      "kind": "agent",
      "message": "POST /api/processes returned 500"
    }
  ]
}
```

### Prompt for `propose-assignments`

`prompts/propose-assignments.md`:

```
You are assigning GitHub issues to team members or AI workflows for a sprint.

You receive:
- A list of open issues (number, title, body, labels, currentAssignee).
- A list of human team members with role hints.
- A list of AI workflow IDs that can take an issue and work on it autonomously.

For each issue, produce a suggested assignment with:
- assigneeId — must be EXACTLY one of the IDs from the members or
  agentWorkflows lists. Do not invent names.
- priority — one of P0, P1, P2, P3.
- note — a short justification (one sentence, optional).

Heuristics:
- If the issue has a `currentAssignee` on GitHub and that ID is in the
  members list, prefer that person.
- Match labels to roles where obvious ("design" → designer, "infra" →
  fullstack with infra background if any, etc.).
- Bug labels with high impact → P0/P1. Enhancements → P2. Tech debt /
  docs → P3.
- If nothing matches a human well, delegate to the first agent workflow
  in the list.

Output strictly the JSON envelope described in the schema below. No prose.

<schema>
{ "inputs": { "items": [...], "assignees": [...] } }
</schema>
```

The agent step's output is validated by a Zod schema; if invalid, the step
fails and re-prompts up to N times per existing agent-runtime conventions.

### Journey test

`__tests__/backlog-triage.journey.test.ts` exercises the workflow end-to-end:

1. Set up: mock GitHub API server returning a fixed set of 3 issues. Mock
   Mediforce `POST /api/processes` returning `{ runId: "test-run-<n>" }`.
   Mock the LLM with a stub that returns a deterministic envelope matching
   the input contract.
2. Trigger the workflow with `repo=owner/repo`, default `members`, default
   `agentWorkflows`.
3. Assert `fetch-backlog` was called and produced expected JSON.
4. Assert `propose-assignments` produced an `inputs` envelope with 3 items.
5. Advance to `assign` — assert the human task was created with
   `ui.component='assignment-table'` and `inputs.items.length === 3`.
6. Submit completionData with 2 assignments (one human, one agent) and 1
   skipped.
7. Assert `dispatch` ran and:
   - Called GitHub PATCH for the human-assigned issue (assertion on
     captured request).
   - Called Mediforce POST for the agent-assigned issue with the right
     `workflowId` and `params.issueNumber`. **No real child workflow
     definition is registered** — the assertion is on the HTTP call shape.
   - The skipped issue is in `dispatch` output `skipped[]`.
8. Assert workflow reached `report` (terminal).

---

## Implementation order

PR-able as one branch with commits in this order. Each commit should be
self-contained and green (typecheck + affected tests).

1. Schema delta: `HumanTask.inputs` field + JSDoc on deprecated `options`.
2. Engine delta: copy `prevOutput.inputs` to `task.inputs`; selection
   back-compat reads from `inputs.options` then `options`. Regression tests.
3. Platform-api DTO: include `inputs` in task responses.
4. Firestore mapper: ensure `inputs` round-trips.
5. UI: `selection-form` reads from `inputs.options ?? options` (regression
   test). Component registry refactor in `task-detail.tsx`.
6. New `assignment-table` component + unit tests.
7. `apps/backlog-triage/`: process-definition.yaml + scripts/* +
   prompts/propose-assignments.md.
8. Journey test for the workflow.
9. Self-review (`/code-review`) and squash if helpful.

## Validation checklist before reporting done

- `pnpm typecheck` clean across all touched packages.
- `pnpm test` clean. No existing tests broken — particularly any
  selection-based human-task tests.
- `pnpm exec mediforce` covers what the dispatch script needs (process
  start with workflowId + params). If not, add the CLI command in the
  same PR (per AGENTS.md rule 3).
- Read `git diff origin/main...HEAD` end to end. Reject your own hacks.
- Run `/code-review`.
- Journey test runs and asserts the mocked Mediforce POST shape — not
  just that "something was called".

## Notes for the implementing agent

- Stick to existing Mediforce conventions (Zod everywhere, no `any`,
  English code, no unrequested doc files). See AGENTS.md.
- Use `pnpm exec mediforce` rather than raw HTTP wherever the CLI covers
  the operation. The dispatch script's "spawn child process" call should
  probably use the CLI binary if available in the script container, not
  raw `fetch`. Check the script-container image for what's available; if
  the CLI is not present, fall back to `requests` against the API and
  document the choice.
- Don't generalize `assignment-table` beyond this spec. The component is
  for one-assignee-per-item with optional priority + note. Multi-assign,
  drag-and-drop columns, etc. are explicitly future work.
- Don't write iframe / `interactive-artifact` machinery. That decision
  was deferred until a workflow genuinely needs ad-hoc HTML.
- If `MEDIFORCE_API_KEY` workflow secret is not yet a supported pattern
  for script steps, surface that as a blocker on the PR — do not
  hardcode keys, do not skip auth.
- If the workflow secrets mechanism does not allow scoping per workflow
  (only per namespace), document that in the PR and proceed with
  namespace-scoped secret.
