import type { HumanTaskStatus } from '@mediforce/platform-core';

/**
 * Cache key factories per ADR-0006 §2.
 *
 * Convention: `[domain, scopeKey?, ...filters]` — string-prefix-first arrays
 * so `qc.invalidateQueries({ queryKey: queryKeys.tasks.all() })` catches
 * every variant under the prefix. Plain values for top-level filters; object
 * literal at the tail when the filter set has multiple fields.
 *
 * Currently covers tasks, cowork, users (`me`), namespace (detail). Future
 * work extends with `runs`, `workflows`, `agent-runs`, `audit`, `monitoring`.
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
  cowork: {
    /** Session metadata key (status, artifact, model, voice config). */
    session: (sessionId: string) => ['cowork', sessionId] as const,
    /** Conversation turns key — separate cache surface from session
     * metadata so chat-mutation optimistic prepends operate on a focused
     * scope without invalidating session metadata. */
    turns: (sessionId: string) => ['cowork', sessionId, 'turns'] as const,
  },

  /**
   * Identity + memberships bundle. ONE-SHOT, `refetchOnWindowFocus: false`
   * per ADR-0006 §4: role / membership changes are a deliberate backend-403
   * canary, not a silent UI mutation. Selectors (`useNamespaceRole`,
   * `usePersonalNamespace`, `useAllUserNamespaces`) read this cache directly.
   */
  users: {
    me: () => ['users', 'me'] as const,
  },

  /** Single-namespace detail (members + metadata). */
  namespace: (handle: string) => ['namespace', handle] as const,
} as const;
