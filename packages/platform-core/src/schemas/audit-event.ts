import { z } from 'zod';

export const AuditEventSchema = z.object({
  /**
   * Storage-generated unique id (Postgres `audit_events.id`, a random
   * uuid). Optional because it's assigned by the repository at write time,
   * never supplied by a caller — `append()`'s input naturally omits it
   * (the base type stays optional so no interface signature change is
   * needed). Exists solely as the keyset-cursor tie-breaker for
   * `getByNamespacePage`: `timestamp` alone can collide when multiple
   * events land in the same request (millisecond-resolution ISO strings).
   */
  id: z.string().optional(),
  // --- Attributable: WHO did it ---
  actorId: z.string().min(1),
  actorType: z.enum(['user', 'agent', 'system']),
  actorRole: z.string(),

  // --- Legible: WHAT happened (human-readable) ---
  action: z.string().min(1),
  description: z.string(),

  // --- Contemporaneous: WHEN it happened ---
  timestamp: z.string().datetime(),
  serverTimestamp: z.string().datetime().optional(),

  // --- Original: exact input/output ---
  inputSnapshot: z.record(z.string(), z.unknown()),
  outputSnapshot: z.record(z.string(), z.unknown()),

  // --- Accurate: ON WHAT BASIS ---
  basis: z.string(),

  // --- Complete: context ---
  entityType: z.string(),
  entityId: z.string(),
  processInstanceId: z.string().optional(),
  // Workspace handle — required when no processInstanceId. The Postgres
  // backend resolves the audit row's workspace column from the parent run
  // when processInstanceId is set; for workspace-scoped events with no
  // parent run (e.g. tool_catalog.entry.created, namespace.created,
  // cron.trigger.fired) the caller must pass `namespace` explicitly.
  // Not persisted as its own column — Postgres stores it in `workspace`.
  namespace: z.string().min(1).optional(),
  stepId: z.string().optional(),

  // --- Consistent: linked to process version ---
  processDefinitionVersion: z.string().optional(),

  // --- Executor/Reviewer role tracking ---
  executorType: z.enum(['human', 'agent', 'script']).optional(), // who executed the step
  reviewerType: z.enum(['human', 'agent', 'none']).optional(), // who reviewed; 'none' for L4
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
