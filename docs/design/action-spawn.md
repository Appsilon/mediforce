# action kind: 'spawn'

**Status:** Draft  
**Date:** 2026-05-26 (updated 2026-05-27)  
**Issue:** #521  
**Decision:** `forEach` lives in spawn action, not on WorkflowStepSchema.
Fan-out over multi-step sub-graphs = child workflows. Engine stays linear (single `currentStepId`).

## Problem

Backlog-triage's `dispatch` step spawns child workflows via an inline script that constructs `fetch('/api/processes', ...)` calls manually. This is:

1. **Not declarative** — cannot validate spawn intent from the WD JSON alone.
2. **Fragile** — hardcoded `APP_BASE_URL`, manual `X-Api-Key` header, bespoke error accumulation logic repeated per workflow.
3. **Invisible** — the engine has no knowledge of the parent-child relationship; no way to query "which runs did this run spawn?" or build a `wait` action later.

## Solution

Add `kind: 'spawn'` to the action discriminated union. The handler calls `ManualTrigger.fireWorkflow` directly (in-process, no HTTP round-trip) for each spawn target, accumulates results, and returns a structured output array.

## Schema

### SpawnActionConfigSchema

```ts
// packages/platform-core/src/schemas/workflow-definition.ts

export const SpawnTargetSchema = z.object({
  /** Workflow definition name to spawn. Must exist in the same namespace. */
  definitionName: z.string().min(1),
  /** Pin to a specific version. Omit to use latest. */
  definitionVersion: z.number().int().positive().optional(),
  /** Trigger name on the target workflow. Defaults to 'manual'. */
  triggerName: z.string().min(1).default('manual'),
  /** Payload passed to the child workflow's trigger. Supports ${...} interpolation. */
  payload: z.record(z.string(), z.unknown()).optional(),
});

export const SpawnActionConfigSchema = z.object({
  /** Single target, or an array of targets for static fan-out. */
  targets: z.union([SpawnTargetSchema, z.array(SpawnTargetSchema)]),
  /**
   * Dynamic fan-out: interpolation template resolving to an array.
   * When set, `targets` must be a single SpawnTargetSchema (the template).
   * The handler interpolates this value first, validates it's an array,
   * then spawns one child per element, making `${item}` available in
   * payload interpolation.
   */
  forEach: z.string().min(1).optional(),
  /** When true (default), per-spawn errors are collected in output.errors[]
   *  and the step completes. When false, first error fails the step. */
  continueOnSpawnError: z.boolean().default(true),
});

// NOTE: No .refine() here — Zod discriminatedUnion requires plain z.object arms.
// The forEach+array conflict is validated in validateExecutorAndTriggers (superRefine):
//   if (step.action?.kind === 'spawn' && config.forEach && Array.isArray(config.targets))
//     → error: "forEach requires a single target template, not an array"
```

### ActionConfigSchema addition

```ts
export const ActionConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'), config: HttpActionConfigSchema }),
  z.object({ kind: z.literal('reshape'), config: ReshapeActionConfigSchema }),
  z.object({ kind: z.literal('email'), config: EmailActionConfigSchema }),
  z.object({ kind: z.literal('spawn'), config: SpawnActionConfigSchema }),  // new
]);
```

## Example WD JSON

### Single spawn

```json
{
  "id": "kick-off-review",
  "name": "Start review workflow",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "spawn",
    "config": {
      "targets": {
        "definitionName": "document-review",
        "payload": {
          "documentId": "${steps.upload.documentId}",
          "requestedBy": "${triggerPayload.userId}"
        }
      }
    }
  }
}
```

### Fan-out spawn (one per item in array)

`forEach` points to an interpolation path resolving to an array. For each element, the handler makes it available as `${item}` (and `${item.field}`) in payload interpolation:

```json
{
  "id": "dispatch",
  "name": "Dispatch perspective requests",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "spawn",
    "config": {
      "forEach": "${steps.prepare.teamMembers}",
      "targets": {
        "definitionName": "gather-perspective",
        "payload": {
          "userId": "${item.userId}",
          "email": "${item.email}",
          "focusArea": "${triggerPayload.focusArea}"
        }
      },
      "continueOnSpawnError": true
    }
  }
}
```

Where `steps.prepare.teamMembers` resolves to:
```json
[
  { "userId": "filip", "email": "filip@appsilon.com" },
  { "userId": "marek", "email": "marek@appsilon.com" }
]
```

### Static multi-target spawn

```json
{
  "id": "fan-out",
  "name": "Start parallel reviews",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "spawn",
    "config": {
      "targets": [
        {
          "definitionName": "legal-review",
          "payload": { "docId": "${steps.upload.docId}" }
        },
        {
          "definitionName": "medical-review",
          "payload": { "docId": "${steps.upload.docId}" }
        }
      ]
    }
  }
}
```

## Handler Behavior

### File: `packages/core-actions/src/handlers/spawn.ts`

Factory function (like `createEmailActionHandler`) because it needs `ManualTrigger` and `ProcessRepository`:

```ts
export function createSpawnActionHandler(
  manualTrigger: ManualTrigger,
  processRepo: ProcessRepository,
  getAppBaseUrl: () => string,
): SpawnActionHandler
```

### Execution flow

1. **Resolve targets.** Normalize `targets` to an array. If `forEach` is set, resolve the path to an array and expand the single target template once per element.
2. **Resolve namespace.** Read from `ActionContext.namespace` (requires extending `ActionContext`).
3. **For each target:**
   - Interpolate `payload` against standard sources. In `forEach` mode, add `item` to sources so `${item.field}` resolves.
   - Resolve `definitionVersion`: if omitted, call `processRepo.getLatestWorkflowVersion(namespace, definitionName)`.
   - Call `manualTrigger.fireWorkflow(...)` directly (in-process, no HTTP).
   - Fire-and-forget the auto-runner kick via internal HTTP.
   - On success, push to `spawned[]`. On error, push to `errors[]`.
4. **Return output.**

### Output shape

```ts
interface SpawnActionOutput {
  spawned: Array<{
    instanceId: string;
    definitionName: string;
    definitionVersion: number;
    status: 'created';
    itemIndex?: number;  // present in forEach mode
  }>;
  errors: Array<{
    definitionName: string;
    itemIndex?: number;
    message: string;
  }>;
  spawnedCount: number;
  errorCount: number;
}
```

### Error handling

Same pattern as backlog-triage dispatch: per-item errors accumulate by default. Output always contains both `spawned[]` and `errors[]`, so downstream transitions can branch:

```json
{ "from": "dispatch", "to": "alert-on-failures", "when": "output.errorCount > 0" }
```

When `continueOnSpawnError: false`, first failure throws and `continueOnError` step-level flag takes over.

### Rate limiting

Hard cap of 50 spawns per step execution. Error: `"spawn fan-out exceeds maximum of 50 children per step execution"`.

### Parent-child tracking

`triggeredBy` on child instance set to `spawn:<parentInstanceId>`. Queryable today without schema changes.

**Known limitation:** `triggeredBy` is copied to `ProcessInstance.createdBy`, which means the child's `createdBy` will show `spawn:abc123` instead of a human actor. Any UI/audit code displaying `createdBy` as a person will show a machine reference. This is acceptable for v1 but explicit `parentInstanceId`/`childInstanceIds` fields on `ProcessInstanceSchema` are required before multi-tenant production use.

## Changes by File

| File | Change |
|------|--------|
| `platform-core/schemas/workflow-definition.ts` | Add `SpawnTargetSchema`, `SpawnActionConfigSchema`; extend `ActionConfigSchema` union; add forEach+array validation to `validateExecutorAndTriggers` |
| `platform-core/index.ts` | Re-export new schemas and types |
| `core-actions/types.ts` | Extend `ActionContext` with `namespace: string`; add `SpawnActionHandler` type alias; extend `InterpolationSources` with optional `item` field |
| `core-actions/interpolation.ts` | Add `item` as a resolvable root in `resolvePath()` |
| `core-actions/handlers/spawn.ts` | New file. Factory `createSpawnActionHandler(...)` |
| `core-actions/handlers/__tests__/spawn.test.ts` | New file. Handler tests (single, fan-out, errors, empty forEach) |
| `core-actions/index.ts` | Export `createSpawnActionHandler` |
| `platform-api/services/platform-services.ts` | Register spawn handler: `actionRegistry.register('spawn', createSpawnActionHandler(manualTrigger, processRepo, getAppBaseUrl))` |
| `platform-ui/.../run/route.ts` | Pass `namespace: initialInstance.namespace` in `ActionContext` |
| `core-actions/validate-action-secrets.ts` | Scan spawn `payload` values for `${secrets.*}` refs |

### Follow-up (separate PR)

`apps/backlog-triage/src/backlog-triage.wd.json` — refactor `dispatch` step to use `spawn` action for agent runs instead of inline script.

## Relation to `wait` Action

`spawn` creates children and returns immediately. `wait` completes the pattern:

```
spawn step --> ... other steps ... --> wait step --> next step
```

`spawn` output is designed with `wait` in mind: `spawned[].instanceId` is the join key. No schema changes to `spawn` needed when `wait` lands.

## Design Decisions

**Why `forEach` lives in spawn, not on WorkflowStepSchema.**
Considered three alternatives:
- (a) `forEach` on WorkflowStepSchema — engine repeats one step N times. Simple but can only iterate a single step; multi-step fan-out (email → human input → validate) is inexpressible.
- (b) True parallel branches in engine — `currentStepId` → `currentStepIds[]`. Full DAG. Rewrites engine fundamentals; months of work.
- (c) Inline sub-workflow (Step Functions Map style) — `forEach` + `subSteps` on a step. Engine-in-engine complexity.

Decision: spawn child workflows (option a-ish with child WDs). Each child is a full workflow definition with its own multi-step graph. Parent engine stays linear. This matches how Temporal (child workflows), Step Functions (Map + sub-state-machine), and BPMN (multi-instance sub-process) handle fan-out over sub-graphs. In pharma context, separate child WDs are a feature: reusable, independently auditable, versioned separately.

`forEach` stays in spawn because it's spawn-specific: "iterate an array and spawn one child per element." Other action kinds (email, http) don't need iteration — if they did later, the pattern would be: wrap them in a child workflow and spawn it N times.

**Why factory function, not standalone handler.** `spawn` needs `ManualTrigger` and `ProcessRepository` as dependencies. Email handler established this pattern with `createEmailActionHandler(sendEmail)`.

**Why `forEach` is a separate field from `targets`.** Keeps two modes obvious: static multi-target (array of different WDs) vs dynamic fan-out (one WD template × N items). Nesting forEach inside each target allows confusing combos with no clear semantics.

**Why in-process `fireWorkflow` instead of HTTP.** Handler sits in same process — calling `manualTrigger.fireWorkflow` directly is simpler, faster, avoids needing `PLATFORM_API_KEY`. Only the auto-runner kick remains HTTP (lives inside Next.js `after()`).

## Edge Cases

1. **`forEach` resolves to empty array** — handler returns `{ spawned: [], errors: [], spawnedCount: 0, errorCount: 0 }`. Not an error; downstream transitions can branch on `spawnedCount == 0`.
2. **`forEach` resolves to non-array** — handler throws: `"forEach resolved to ${typeof result}, expected array"`.
3. **`forEach` + array targets** — rejected at schema validation (superRefine), never reaches handler.

## Open Questions

1. **Cross-namespace spawn.** v1 restricts to parent's namespace. CRO-to-sponsor use cases may need cross-namespace with permission grants later.
2. **Concurrency.** Fan-out spawns sequential in v1. `Promise.all` risks Firestore write overload. Future: configurable `concurrency` parameter.
3. **Child → parent write-back.** The `wait` action needs to know when children complete. Two options: (a) the wait handler's heartbeat actively queries child instance statuses via `instanceRepo.getById()`, or (b) child completion triggers a callback that updates parent variables. v1 uses (a) — the heartbeat sweep checks child statuses on each poll. No write-back mechanism needed.
