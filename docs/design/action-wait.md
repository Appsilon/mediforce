# action kind: 'wait'

**Status:** Draft  
**Date:** 2026-05-26  
**Issue:** #521

## Problem

Workflows need to pause for a period of time, until a deadline, or until a condition is met (e.g. spawned child workflows complete). No engine-level primitive for this today — the only way to pause is via human tasks or agent escalation.

## Decision

Add `wait` as a new kind in the `ActionConfigSchema` discriminated union. The handler **pauses the instance** with metadata that the auto-runner checks on subsequent polls.

## Schema

### WaitActionConfigSchema

```ts
// packages/platform-core/src/schemas/workflow-definition.ts

export const WaitActionConfigSchema = z.object({
  /** Pause for a fixed duration. Mutually exclusive with `deadline`. */
  duration: z.object({
    seconds: z.number().int().nonnegative().optional(),
    minutes: z.number().int().nonnegative().optional(),
    hours:   z.number().int().nonnegative().optional(),
  }).optional(),

  /** Pause until a specific ISO-8601 datetime. Supports ${...} interpolation
   *  (e.g. "${steps.schedule.collectUntil}"). Mutually exclusive with `duration`. */
  deadline: z.string().min(1).optional(),

  /** Optional early-resume condition. Same expression DSL as transition `when`
   *  clauses. Evaluated on every auto-runner poll against instance.variables.
   *  When truthy, wait ends early with resumeReason: 'condition_met'. */
  condition: z.string().optional(),
});

// NOTE: No .refine() here — Zod discriminatedUnion requires plain z.object arms.
// Mutual exclusivity (exactly one of duration/deadline) and zero-duration guard
// are validated in validateExecutorAndTriggers (superRefine on WorkflowDefinitionSchema):
//   if (step.action?.kind === 'wait') {
//     const c = step.action.config;
//     if ((c.duration !== undefined) === (c.deadline !== undefined))
//       → error: "Exactly one of duration or deadline must be set"
//     if (c.duration && totalSeconds(c.duration) === 0)
//       → error: "Duration must be greater than zero"
//   }
```

### ActionConfigSchema addition

```ts
export const ActionConfigSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('http'),    config: HttpActionConfigSchema }),
  z.object({ kind: z.literal('reshape'), config: ReshapeActionConfigSchema }),
  z.object({ kind: z.literal('email'),   config: EmailActionConfigSchema }),
  z.object({ kind: z.literal('spawn'),   config: SpawnActionConfigSchema }),
  z.object({ kind: z.literal('wait'),    config: WaitActionConfigSchema }),  // new
]);
```

## Handler Behavior

### On step execution

File: `packages/core-actions/src/handlers/wait.ts`

The handler is a pure function — it computes `resumeAt` and returns a `__wait` sentinel. The auto-runner intercepts this and pauses the instance.

```ts
export const waitActionHandler: WaitActionHandler = async (config, ctx) => {
  const now = new Date();
  let resumeAt: Date;

  if (config.duration) {
    const { seconds = 0, minutes = 0, hours = 0 } = config.duration;
    const totalMs = ((hours * 60 + minutes) * 60 + seconds) * 1000;
    resumeAt = new Date(now.getTime() + totalMs);
  } else {
    const parsed = new Date(config.deadline!);
    if (isNaN(parsed.getTime())) {
      throw new Error(`Invalid deadline: '${config.deadline}'`);
    }
    if (parsed <= now) {
      // Deadline already past -- resume immediately, no pause
      return { resumeReason: 'deadline_reached', waitedSeconds: 0, resolvedAt: now.toISOString() };
    }
    resumeAt = parsed;
  }

  return {
    __wait: {
      stepId: ctx.stepId,
      resumeAt: resumeAt.toISOString(),
      pausedAt: now.toISOString(),
      ...(config.condition ? { condition: config.condition } : {}),
    },
  };
};
```

### Auto-runner changes

File: `packages/platform-ui/src/app/api/processes/[instanceId]/run/route.ts`

Two additions:

#### 1. After action dispatch — detect `__wait` sentinel and pause

```ts
if (output.__wait && typeof output.__wait === 'object') {
  await instanceRepo.update(instanceId, {
    status: 'paused',
    pauseReason: 'waiting_for_timer',
    variables: { ...instance.variables, __wait: output.__wait },
    updatedAt: new Date().toISOString(),
  });
  break;
}
```

#### 2. At top of loop — check if timer-paused instance is ready

```ts
if (instance.status === 'paused' && instance.pauseReason === 'waiting_for_timer') {
  const waitMeta = instance.variables.__wait;
  const now = new Date();
  const resumeAt = new Date(waitMeta.resumeAt);

  let conditionMet = false;
  if (waitMeta.condition) {
    conditionMet = evaluateExpression(waitMeta.condition, {
      output: instance.variables,
      variables: instance.variables,
    });
  }

  if (now >= resumeAt || conditionMet) {
    const waitedSeconds = Math.round((now.getTime() - new Date(waitMeta.pausedAt).getTime()) / 1000);
    const resumeReason = conditionMet ? 'condition_met'
      : 'duration_elapsed';
    const waitOutput = { resumeReason, waitedSeconds, resolvedAt: now.toISOString() };

    const { __wait: _, ...cleanVars } = instance.variables;
    await instanceRepo.update(instanceId, {
      status: 'running', pauseReason: null,
      variables: { ...cleanVars, [waitMeta.stepId]: waitOutput },
      updatedAt: now.toISOString(),
    });
    await engine.advanceStep(instanceId, waitOutput, { id: 'auto-runner', role: 'system' });
    continue;
  }
  break; // not ready yet, next poll will re-check
}
```

### Resume path

**Critical:** The run endpoint (`POST /api/processes/:id/run`) rejects paused instances with 409. The auto-runner loop guards `if (instance.status !== 'running') break`. So the timer resume logic has no execution path through the existing code.

**Solution: dedicated resume-wait endpoint.** New route `POST /api/processes/:id/resume-wait`:

1. Load instance, verify `status === 'paused' && pauseReason === 'waiting_for_timer'`
2. Read `variables.__wait`, check `resumeAt <= now` or evaluate `condition`
3. If ready: set `status: 'running'`, clear `pauseReason`, write wait output, call `engine.advanceStep()`
4. If not ready: return 200 with `{ ready: false, resumeAt }`

This avoids modifying the `status !== 'running'` guard that protects other code paths.

### Polling / heartbeat

**The cron heartbeat at `platform-ui/src/app/api/cron/heartbeat/route.ts` today only fires cron-triggered workflow instances.** It does NOT sweep paused instances. A new section must be added:

1. Query all instances: `status === 'paused' && pauseReason === 'waiting_for_timer'`
2. For each, check `variables.__wait.resumeAt <= now` (cheap, no expression eval needed for time check)
3. POST `resume-wait` endpoint for eligible instances
4. Catch per-instance errors (don't let one broken condition crash the sweep)

This gives ~15-min granularity at zero infrastructure cost.

**Future: BullMQ delayed job.** When `REDIS_URL` is set, the wait handler enqueues a delayed job at the exact `resumeAt` timestamp. The `container-worker` picks it up for second-precision accuracy.

15-minute granularity is fine for v1 use cases (wait hours/days, collect responses until Friday).

## New pause reason

```
'waiting_for_timer'
```

`pauseReason` is `z.string().nullable()` (not an enum), so zero schema migration needed.

### Wait metadata

Stored in `instance.variables.__wait` (double-underscore = engine internal, never a valid step id):

```ts
interface WaitMetadata {
  stepId: string;
  resumeAt: string;    // ISO-8601
  pausedAt: string;    // ISO-8601
  condition?: string;  // raw expression string
}
```

## Output shape

```ts
interface WaitActionOutput {
  resumeReason: 'deadline_reached' | 'duration_elapsed' | 'condition_met';
  waitedSeconds: number;
  resolvedAt: string; // ISO-8601
}
```

## Example WD JSON

### Simple duration wait

```json
{
  "id": "wait-2h",
  "name": "Wait 2 hours",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "wait",
    "config": {
      "duration": { "hours": 2 }
    }
  }
}
```

### Deadline wait (interpolated from trigger input)

```json
{
  "id": "wait-until-deadline",
  "name": "Collect responses until deadline",
  "type": "creation",
  "executor": "action",
  "action": {
    "kind": "wait",
    "config": {
      "deadline": "${triggerPayload.collectUntil}"
    }
  }
}
```

### Spawn + wait-for-children pattern

```json
[
  {
    "id": "spawn-perspectives",
    "name": "Dispatch to team",
    "type": "creation",
    "executor": "action",
    "action": {
      "kind": "spawn",
      "config": {
        "forEach": "${steps.prepare.teamMembers}",
        "targets": {
          "definitionName": "gather-perspective",
          "payload": { "userId": "${item.userId}", "email": "${item.email}" }
        }
      }
    }
  },
  {
    "id": "wait-for-responses",
    "name": "Wait for responses or deadline",
    "type": "creation",
    "executor": "action",
    "action": {
      "kind": "wait",
      "config": {
        "deadline": "${triggerPayload.collectUntil}",
        "condition": "variables.spawn_perspectives.allCompleted == true"
      }
    }
  }
]
```

### Transition branching on resume reason

```json
{
  "transitions": [
    { "from": "wait-for-responses", "to": "aggregate-all",    "when": "output.resumeReason == \"condition_met\"" },
    { "from": "wait-for-responses", "to": "aggregate-partial", "when": "output.resumeReason == \"duration_elapsed\"" }
  ]
}
```

## Condition expression DSL

Uses existing `evaluateExpression()` from `workflow-engine/src/expressions/expression-evaluator.ts`. Context:

```ts
{
  output: instance.variables,
  variables: instance.variables,
  verdict: undefined,
}
```

Example conditions:

| Expression | Meaning |
|---|---|
| `variables.spawn_perspectives.allCompleted == true` | All child workflows done |
| `variables.collect.responseCount >= 5` | Enough responses |

**Constraint:** Step IDs used in condition expressions must use underscores, not hyphens. The expression parser's `isIdentChar()` only accepts `[a-zA-Z_0-9]` — hyphens would be parsed as subtraction. Example: use `spawn_perspectives` not `spawn-perspectives` as the step ID.

## Changes by File

| File | Change |
|------|--------|
| `platform-core/schemas/workflow-definition.ts` | Add `WaitActionConfigSchema`; extend `ActionConfigSchema` union; add duration/deadline validation to `validateExecutorAndTriggers` |
| `platform-core/index.ts` | Re-export new types |
| `core-actions/handlers/wait.ts` | New file: wait handler |
| `core-actions/handlers/__tests__/wait.test.ts` | New file: handler tests |
| `core-actions/types.ts` | Add `WaitActionHandler` type |
| `core-actions/index.ts` | Re-export `waitActionHandler` |
| `platform-ui/.../run/route.ts` | `__wait` sentinel detection after action dispatch (before `advanceStep`) |
| `platform-ui/src/app/api/processes/[instanceId]/resume-wait/route.ts` | New endpoint: check timer, resume if ready |
| `platform-ui/src/app/api/cron/heartbeat/route.ts` | Add sweep: query `waiting_for_timer` instances, POST resume-wait for eligible |
| `platform-ui/lib/workflow-status.ts` | Add `waiting_for_timer` display mapping |
| `platform-api/services/platform-services.ts` | Register `waitActionHandler` |

## Edge cases

1. **Deadline in the past**: handler returns immediately, `waitedSeconds: 0`. No pause.
2. **Duration zero**: rejected by superRefine validation.
3. **Condition already true at pause time**: resolves on next heartbeat poll (~15 min max).
4. **Instance manually resumed**: `pauseReason` cleared → auto-runner re-enters wait step, handler checks deadline again (idempotent — if deadline passed, returns immediately; if not, re-pauses with fresh `__wait`).
5. **Server restart**: no in-memory state. `resumeAt` and `condition` persisted in Firestore. Heartbeat picks up on next tick.
6. **Condition expression throws**: heartbeat sweep catches per-instance errors, logs, continues to next instance. Never crashes the entire sweep.
7. **Two sequential wait steps**: first wait's `__wait` is cleaned up on resume before second wait writes its own. No collision.
8. **`__wait` collision with external API response**: tighter sentinel check: verify `output.__wait?.stepId` matches current step ID, not just `typeof === 'object'`.

## Design decisions

**`__wait` sentinel pattern.** Handlers are pure functions that return data — they can't pause instances directly. The auto-runner owns lifecycle transitions, so it intercepts the sentinel.

**`variables.__wait` not a first-class field.** Avoids Firestore migration and touching every ProcessInstance read path.

**Cron heartbeat for v1.** BullMQ upgrade path is clean when sub-minute precision matters.

**`action` executor, not new `timer` executor.** New executor type has much larger blast radius (workflow editor, step-status-panel, all executor switches). Action kind is additive-only.
