import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { seedCollection } from '../helpers/emulator';
import { OUTSIDER_NAMESPACE, setupMultiNamespaceCallers } from '../helpers/multi-namespace';
import { setupRecording, click, showCaption, endRecording } from '../helpers/recording';

/**
 * L4 UI E2E — cross-workspace namespace isolation on the tasks page (issue #447).
 *
 * Before the fix: `useMyTasks` fetched tasks by `assignedRole` with no namespace
 * filter, so a user holding the same role in two namespaces would see tasks from
 * both workspaces when browsing one workspace page.
 *
 * After the fix: a client-side filter `task.namespace === namespace` (where
 * `namespace` comes from the URL `handle`) drops tasks that belong to other
 * namespaces before they reach the UI.
 *
 * Journey proves: browsing `/test/tasks` as a `reviewer` shows only tasks with
 * `namespace: 'test'`, and hides tasks with `namespace: 'other'` even when they
 * share the same `assignedRole`.
 */

const NOW = new Date().toISOString();
const NEXT_WEEK = new Date(Date.now() + 7 * 86400_000).toISOString();

test.describe('Tasks — cross-workspace namespace isolation (issue #447)', () => {
  test.beforeAll(async () => {
    await setupMultiNamespaceCallers();

    // Process instance in the outsider namespace — the one backing the leak task.
    // Uses a unique definitionName so the test can assert its absence.
    await seedCollection('processInstances', {
      'proc-ns-iso-other': {
        id: 'proc-ns-iso-other',
        namespace: OUTSIDER_NAMESPACE,
        definitionName: 'Cross Namespace Leak Workflow',
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

    // Process instance in the test namespace — backing the visible task.
    await seedCollection('processInstances', {
      'proc-ns-iso-visible': {
        id: 'proc-ns-iso-visible',
        namespace: TEST_ORG_HANDLE,
        definitionName: 'Namespace Isolation Test Workflow',
        definitionVersion: '1.0.0',
        status: 'paused',
        currentStepId: 'isolation-review',
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

    // Task in the outsider namespace — same assignedRole as the test user.
    // This is the "leak" task that must NOT appear when browsing /test/tasks.
    await seedCollection('humanTasks', {
      'task-ns-iso-leak': {
        id: 'task-ns-iso-leak',
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

    // Task in the test namespace — must be visible at /test/tasks.
    // namespace field is explicitly set so the client-side filter includes it.
    await seedCollection('humanTasks', {
      'task-ns-iso-visible': {
        id: 'task-ns-iso-visible',
        processInstanceId: 'proc-ns-iso-visible',
        stepId: 'isolation-review',
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

  test('browsing /test/tasks shows only test-namespace tasks', async ({ page }, testInfo) => {
    await setupRecording(page, 'tasks-namespace-isolation', testInfo);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);
    // Wait for the hook to resolve the user's role and load tasks.
    await expect(page.getByRole('heading', { name: 'New actions' })).toBeVisible({ timeout: 30_000 });
    await showCaption(page, 'Task inbox for test workspace');

    // The test-namespace task's workflow name must appear — proves namespace filter
    // does not hide legitimate tasks that carry the correct namespace.
    await expect(page.getByText('Namespace Isolation Test Workflow')).toBeVisible({ timeout: 10_000 });
    await showCaption(page, 'Test-namespace task visible in inbox');

    // The other-namespace task's workflow name must NOT appear — proves the
    // client-side hook filter drops tasks with namespace !== 'test'.
    await expect(page.getByText('Cross Namespace Leak Workflow')).not.toBeVisible();
    await showCaption(page, 'Cross-namespace task correctly excluded', 2000);

    // Scroll down to confirm the leak task is not hidden further in the list.
    await click(page, page.getByRole('heading', { name: 'New actions' }));
    await showCaption(page, 'No cross-workspace tasks bleed into this inbox', 2500);

    await endRecording(page);
  });
});
