import type { HumanTaskStatus } from '@mediforce/platform-core';

/**
 * Cache key factories per ADR-0006 §2.
 *
 * Convention: `[domain, scopeKey?, ...filters]` — string-prefix-first arrays
 * so `qc.invalidateQueries({ queryKey: queryKeys.tasks.all() })` catches
 * every variant under the prefix. Plain values for top-level filters; object
 * literal at the tail when the filter set has multiple fields.
 *
 * Currently covers the `tasks` domain. Future work extends with `runs`,
 * `workflows`, `agent-runs`, `cowork`, `audit`, `namespace`, `users`,
 * `monitoring`.
 */
export const queryKeys = {
  tasks: {
    /** Prefix matcher — `['tasks']` invalidates every list slice. */
    all: () => ['tasks'] as const,
    /** All tasks for a process instance, optionally narrowed by stepId. */
    byInstance: (instanceId: string, filters?: { stepId?: string; status?: HumanTaskStatus[] }) =>
      ['tasks', { instanceId, ...filters }] as const,
    /** All tasks for a role, optionally narrowed by status. */
    byRole: (role: string, filters?: { status?: HumanTaskStatus[] }) =>
      ['tasks', { role, ...filters }] as const,
  },
  /**
   * Single-task detail key. Lives under its own domain (`'task'` singular)
   * so list-prefix invalidation of `['tasks']` does not clobber the detail
   * cache — detail and list are different cache surfaces.
   */
  task: (taskId: string) => ['task', taskId] as const,
} as const;
