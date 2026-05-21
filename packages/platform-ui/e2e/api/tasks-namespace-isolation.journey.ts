import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  OUTSIDER_NAMESPACE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';
import { seedCollection } from '../helpers/emulator';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API E2E — cross-workspace namespace isolation for tasks (issue #447).
 *
 * The bug: client-side Firestore hooks were fetching tasks by `assignedRole`
 * without a namespace filter, so a user holding the same role in two
 * namespaces would see tasks from both when browsing one workspace.
 *
 * The fix stamps `namespace` on every newly-created HumanTask and CoworkSession
 * so the client-side hooks can filter by it. This journey proves:
 *
 *   1. API-level isolation — a task in namespace `other` is 404 for a user
 *      who is only a member of namespace `test`.
 *   2. Namespace field is present on tasks — GET /api/tasks/[id] returns the
 *      `namespace` field so the client-side hook has data to filter on.
 *   3. Role-listing isolation — GET /api/tasks?role=reviewer as the `test`
 *      user excludes tasks from namespace `other` even when they share the
 *      same assignedRole.
 */

const NOW = new Date().toISOString();
const NEXT_WEEK = new Date(Date.now() + 7 * 86400_000).toISOString();

test.describe('Tasks — cross-workspace namespace isolation (issue #447)', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();

    // Task in the outsider's namespace — same assignedRole as test-namespace
    // tasks, simulating the role-overlap leak from the issue.
    await seedCollection('humanTasks', {
      'task-ns-iso-other': {
        id: 'task-ns-iso-other',
        processInstanceId: 'proc-ns-iso-other',
        stepId: 'human-review',
        assignedRole: 'reviewer',
        assignedUserId: null,
        status: 'pending',
        namespace: OUTSIDER_NAMESPACE,
        deadline: NEXT_WEEK,
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: null,
        completionData: null,
      },
    });

    await seedCollection('processInstances', {
      'proc-ns-iso-other': {
        id: 'proc-ns-iso-other',
        namespace: OUTSIDER_NAMESPACE,
        definitionName: 'Supply Chain Review',
        definitionVersion: '1.0.0',
        status: 'paused',
        currentStepId: 'human-review',
        variables: {},
        triggerType: 'manual',
        triggerPayload: {},
        createdAt: NOW,
        updatedAt: NOW,
        createdBy: 'system',
        pauseReason: 'waiting_for_human',
        error: null,
        assignedRoles: ['reviewer'],
      },
    });

    // Task in the test namespace — namespace field explicitly set, so the
    // API response carries it and the client-side hook can trust the filter.
    await seedCollection('humanTasks', {
      'task-ns-iso-test': {
        id: 'task-ns-iso-test',
        processInstanceId: 'proc-running-1',
        stepId: 'assess-supplier-risk',
        assignedRole: 'reviewer',
        assignedUserId: null,
        status: 'pending',
        namespace: TEST_ORG_HANDLE,
        deadline: NEXT_WEEK,
        createdAt: NOW,
        updatedAt: NOW,
        completedAt: null,
        completionData: null,
      },
    });
  });

  test('task in other namespace returns 404 for test-namespace user', async ({ request }) => {
    const res = await request.get('/api/tasks/task-ns-iso-other', {
      headers: bearerHeaders(callers.member),
    });
    expect(res.status()).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toMatch(/not found/i);
  });

  test('task namespace field is present in API response', async ({ request }) => {
    const res = await request.get('/api/tasks/task-ns-iso-test', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const task = await res.json() as { id: string; namespace?: string };
    expect(task.namespace).toBe(TEST_ORG_HANDLE);
  });

  test('listing tasks by role excludes tasks from other namespace for user caller', async ({ request }) => {
    const res = await request.get('/api/tasks?role=reviewer', {
      headers: bearerHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { tasks: Array<{ id: string; namespace?: string }> };

    const ids = body.tasks.map((t) => t.id);
    expect(ids).not.toContain('task-ns-iso-other');

    // Positive assertion: test-namespace task IS visible to the test user.
    expect(ids).toContain('task-ns-iso-test');

    // Every returned task must belong to the test namespace — no cross-namespace bleed.
    const withNamespace = body.tasks.filter((t) => t.namespace !== undefined);
    for (const task of withNamespace) {
      expect(task.namespace).toBe(TEST_ORG_HANDLE);
    }
  });
});
