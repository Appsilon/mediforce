import { z } from 'zod';
import { HumanTaskSchema, HumanTaskStatusSchema, type HumanTaskStatus } from '@mediforce/platform-core';

/**
 * Contract for `GET /api/tasks`.
 *
 * Exactly one of `instanceId` or `role` must be provided; every other filter
 * combines multiplicatively with the chosen axis:
 *   - `instanceId` — return tasks belonging to that process instance
 *   - `role`       — return tasks assigned to that role
 *   - `stepId`     — further narrow to a specific step within the instance/role
 *   - `status`     — list of statuses to include. Pass `ACTIONABLE_STATUSES`
 *                    for the typical "my queue" view (pending + claimed).
 */
export const ListTasksInputSchema = z
  .object({
    instanceId: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    status: z.array(HumanTaskStatusSchema).min(1).optional(),
  })
  .refine(
    (val) => (val.instanceId !== undefined) !== (val.role !== undefined),
    { message: 'Exactly one of `instanceId` or `role` is required' },
  );

export const ListTasksOutputSchema = z.object({
  tasks: z.array(HumanTaskSchema),
});

/**
 * Common shortcut — the set of statuses a human would see in an "actionable
 * tasks" queue. Exported so UI and agents agree on what "actionable" means.
 */
export const ACTIONABLE_STATUSES: readonly HumanTaskStatus[] = ['pending', 'claimed'] as const;

interface ListTasksFilters {
  stepId?: string;
  status?: HumanTaskStatus[];
}

/**
 * Modeled as a discriminated union so handlers narrow with a plain
 * conditional — no invariant throw. The Zod refine on `ListTasksInputSchema`
 * is what enforces exactly-one-of at parse time; this type describes what a
 * successful parse guarantees.
 */
export type ListTasksInput =
  | (ListTasksFilters & { instanceId: string; role?: undefined })
  | (ListTasksFilters & { role: string; instanceId?: undefined });

export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;

/**
 * Contract for `GET /api/tasks/:taskId`.
 *
 * The output is the raw `HumanTaskSchema` — single resource, no wrapper
 * object. Missing tasks return HTTP 404 (the handler throws `NotFoundError`,
 * the route adapter maps it to an error body). Keeps the response shape
 * identical to `tasks[i]` from `GET /api/tasks`, so clients can reuse the
 * same type and fixtures.
 */
export const GetTaskInputSchema = z.object({
  taskId: z.string().min(1),
});

export const GetTaskOutputSchema = HumanTaskSchema;

export type GetTaskInput = z.infer<typeof GetTaskInputSchema>;
export type GetTaskOutput = z.infer<typeof GetTaskOutputSchema>;

/**
 * Contract for `POST /api/tasks/:taskId/claim`.
 *
 * `userId` defaults to `'api-user'` server-side when omitted; the schema keeps
 * it optional so clients without an identity claim can still hit the endpoint
 * (preserves pre-migration behaviour).
 */
export const ClaimTaskInputSchema = z.object({
  taskId: z.string().min(1),
  userId: z.string().min(1).optional(),
});

export const ClaimTaskOutputSchema = HumanTaskSchema;

export type ClaimTaskInput = z.infer<typeof ClaimTaskInputSchema>;
export type ClaimTaskOutput = z.infer<typeof ClaimTaskOutputSchema>;

/**
 * Contract for `POST /api/tasks/:taskId/complete`.
 *
 * State-machine precondition: the task must be in `claimed` status. Other
 * statuses return `ConflictError` (409). On success the handler also resumes
 * the paused instance, advances the engine, and fires `/run` out-of-band.
 */
export const CompleteTaskInputSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['approve', 'revise'], {
    error: () => ({ message: 'verdict must be "approve" or "revise"' }),
  }),
  comment: z.string().optional(),
});

export const CompleteTaskOutputSchema = z.object({
  ok: z.literal(true),
  taskId: z.string(),
  verdict: z.enum(['approve', 'revise']),
  processInstanceId: z.string(),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskInputSchema>;
export type CompleteTaskOutput = z.infer<typeof CompleteTaskOutputSchema>;

/**
 * Contract for `POST /api/tasks/:taskId/resolve`.
 *
 * Single endpoint, three body shapes (verdict / paramValues / attachments).
 * Handler validates the body against the task's expected shape at runtime;
 * the Zod schema is permissive here because what counts as "valid" depends on
 * task.ui.component + task.params, which are only known after the task is
 * loaded.
 */
const AttachmentSchema = z.object({
  name: z.string({ error: 'attachment name is required' }).min(1, 'attachment name is required'),
  size: z.number().positive('attachment size must be positive'),
  type: z.string().min(1, 'attachment type is required'),
  storagePath: z.string().optional(),
  downloadUrl: z.string().optional(),
});

export const ResolveTaskInputSchema = z.object({
  taskId: z.string().min(1),
  verdict: z.enum(['approve', 'revise']).optional(),
  comment: z.string().optional(),
  selectedIndex: z.number().int().nonnegative().optional(),
  paramValues: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(AttachmentSchema).optional(),
});

export const ResolveTaskOutputSchema = z.object({
  ok: z.literal(true),
  taskId: z.string(),
  resolvedStepId: z.string(),
  processInstanceId: z.string(),
  nextStepId: z.string().nullable(),
  status: z.string(),
});

export type ResolveTaskInput = z.infer<typeof ResolveTaskInputSchema>;
export type ResolveTaskOutput = z.infer<typeof ResolveTaskOutputSchema>;
