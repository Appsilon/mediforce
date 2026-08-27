import { z } from 'zod';
import {
  HumanTaskSchema,
  HumanTaskStatusSchema,
  ProcessInstanceSchema,
  CompleteHumanTaskPayloadSchema,
  AttachmentSchema,
  AssignmentItemSchema,
  TableEditorRowSchema,
  type HumanTaskStatus,
  type Attachment,
  type AssignmentItem,
  type TableEditorRow,
  type CompleteHumanTaskPayload,
} from '@mediforce/platform-core';

/**
 * Contract for `GET /api/tasks`.
 *
 * Three base axes, all optional. The handler picks the narrowest applicable
 * path:
 *   - `instanceId` — return tasks belonging to that process instance
 *   - `role`       — return tasks assigned to that role
 *   - neither      — caller-scope: every task whose parent run belongs to
 *                    a workspace the caller is a member of (system actors
 *                    see everything). GitHub-like default — no axis means
 *                    "my queue across the workspaces I belong to".
 *
 * `instanceId` and `role` are mutually exclusive; passing both is rejected.
 * `stepId`, `status[]` and `actionable` further narrow whichever base set is
 * chosen.
 */
export const ListTasksInputSchema = z
  .object({
    instanceId: z.string().min(1).optional(),
    role: z.string().min(1).optional(),
    stepId: z.string().min(1).optional(),
    status: z.array(HumanTaskStatusSchema).min(1).optional(),
    // Narrows the `role` / caller-scope axes to one workspace. Intersection
    // semantics like `runs.list` — a namespace the caller isn't a member of
    // yields an empty list, not a 403.
    namespace: z.string().min(1).optional(),
    /**
     * `true` narrows the result to the tasks the caller can actually act on:
     * assigned to them, or `pending` and unassigned with a step whose
     * `allowedRoles` they hold for that workflow (or which declares none).
     * Omitted returns what the axis returns today, byte for byte — the
     * unfiltered view stays reachable, which is what makes narrowing the
     * default inbox a choice rather than a regression (issue #1251).
     *
     * A system actor has no roles to hold and no inbox of its own, so
     * `actionable` is a no-op for apiKey callers rather than an empty list.
     *
     * Accepts a real boolean (client callers) or the `'true'` / `'false'` a
     * query string carries (the route adapter), so one schema serves both —
     * see `ListRunsPageClientInputSchema` for what the alternative costs.
     */
    actionable: z
      .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
      .optional(),
  })
  .refine(
    (val) => !(val.instanceId !== undefined && val.role !== undefined),
    { message: '`instanceId` and `role` are mutually exclusive' },
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
  namespace?: string;
  actionable?: boolean;
}

/**
 * Three-way discriminated union — exactly one of `instanceId` / `role` /
 * "neither" is the post-parse guarantee. The `.refine()` on
 * `ListTasksInputSchema` enforces the mutual-exclusion at parse time; this
 * type describes what a successful parse delivers to the handler.
 */
export type ListTasksInput =
  | (ListTasksFilters & { instanceId: string; role?: undefined })
  | (ListTasksFilters & { role: string; instanceId?: undefined })
  | (ListTasksFilters & { instanceId?: undefined; role?: undefined });

export type ListTasksOutput = z.infer<typeof ListTasksOutputSchema>;

/**
 * Contract for `GET /api/tasks/:taskId`.
 *
 * Output is the raw `HumanTaskSchema` — single resource, no wrapper. A
 * missing task surfaces as 404 (handler throws `NotFoundError`, adapter maps
 * it). Same shape as `tasks[i]` from the list endpoint, so clients reuse the
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
 * the auth carrier (NextAuth session cookie for browser, `X-Api-Key` for S2S), not
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

/**
 * Contract for `POST /api/tasks/:taskId/viewed`.
 *
 * Fire-and-forget instrumentation — records that the caller opened the task
 * view, so Monitoring → Tasks can show a real `task.viewed` audit trail
 * instead of having no signal for "someone looked at this". Same
 * path-derived-taskId shape as `claim`; no state change on the task itself.
 */
export const RecordTaskViewedInputSchema = z.object({
  taskId: z.string().min(1),
});

export const RecordTaskViewedOutputSchema = z.object({
  recorded: z.literal(true),
});

export type RecordTaskViewedInput = z.infer<typeof RecordTaskViewedInputSchema>;
export type RecordTaskViewedOutput = z.infer<typeof RecordTaskViewedOutputSchema>;

// Payload schemas live in platform-core so workflow-engine can import them
// without an upward dep on platform-api.
export {
  AttachmentSchema,
  AssignmentItemSchema,
  TableEditorRowSchema,
  CompleteHumanTaskPayloadSchema as CompleteTaskPayloadSchema,
};
export type { Attachment, AssignmentItem, TableEditorRow };
export type CompleteTaskPayload = CompleteHumanTaskPayload;

export const CompleteTaskInputSchema = z.object({
  taskId: z.string().min(1),
  payload: CompleteHumanTaskPayloadSchema,
});

export const CompleteTaskOutputSchema = z.object({
  task: HumanTaskSchema,
  run: ProcessInstanceSchema,
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskInputSchema>;
export type CompleteTaskOutput = z.infer<typeof CompleteTaskOutputSchema>;
