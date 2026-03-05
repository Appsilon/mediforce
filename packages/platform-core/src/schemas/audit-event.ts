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
  stepId: z.string().optional(),

  // --- Consistent: linked to process version ---
  processDefinitionVersion: z.string().optional(),

  // --- Executor/Reviewer role tracking ---
  executorType: z.enum(['human', 'agent']).optional(), // who executed the step
  reviewerType: z.enum(['human', 'agent', 'none']).optional(), // who reviewed; 'none' for L4
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;
