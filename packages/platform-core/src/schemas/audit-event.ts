import { z } from 'zod';

export const AuditEventSchema = z.object({
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
  executorType: z.enum(['human', 'agent']).optional(), // who executed the step
  reviewerType: z.enum(['human', 'agent', 'none']).optional(), // who reviewed; 'none' for L4
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
