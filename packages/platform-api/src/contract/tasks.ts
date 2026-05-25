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
 * Output is the raw `HumanTaskSchema` — single resource, no wrapper. A
 * missing task surfaces as 404 (handler throws `ApiError('not_found', …)`,
 * adapter maps it). Same shape as `tasks[i]` from the list endpoint, so clients reuse the
 * type.
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
 * Input is just the path-derived `taskId` — the claimer's identity comes from
 * the auth carrier (Firebase ID token for browser, `X-Api-Key` for S2S), not
 * the request body. Per ADR-0005 §5 the response echoes the post-mutation
 * entity (status `claimed`, `assignedUserId` set).
 */
export const ClaimTaskInputSchema = z.object({
  taskId: z.string().min(1),
});

export const ClaimTaskOutputSchema = z.object({
  task: HumanTaskSchema,
});

export type ClaimTaskInput = z.infer<typeof ClaimTaskInputSchema>;
export type ClaimTaskOutput = z.infer<typeof ClaimTaskOutputSchema>;
