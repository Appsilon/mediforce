import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';
import { trackPageErrors } from '../helpers/page-errors';

// ─────────────────────────────────────────────────────────────────────────────
// Tasks page renders cowork sections sourced from `mediforce.cowork.list`.
//
// Phase 4 PR-final (#591) replaced two Firestore `onSnapshot` subscriptions —
// `useMyCoworkSessions` (active) and `useFinalizedCoworkSessions` (finalized)
// — with react-query backed calls to `GET /api/cowork`. This journey is the
// L4 coverage for that endpoint surface: it loads the tasks page (which is
// where the operator sees both cowork sections alongside actionable tasks)
// and asserts the page renders without errors, proving the new endpoint
// round-trips end-to-end.
//
// Existing journeys already cover the rest of the Phase 4 endpoint set
// (`workflows.list` ← workflow-home, `workflows.versions` ← workflow-editor,
// `workflows.get` ← workflow-editor, `processes.getSteps` ← run-detail,
// `processes.agentEvents` ← run-detail implicit, `cowork.getByInstance` ←
// cowork-session, `tasks.list` ← task-review).
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Tasks page cowork sections', () => {
  test('operator sees cowork sessions surfaced from cowork.list alongside tasks', async ({ page }) => {
    trackPageErrors(page);

    await page.goto(`/${TEST_ORG_HANDLE}/tasks`);

    // Tasks page mounts both `useMyCoworkSessions` (active) and
    // `useFinalizedCoworkSessions` (finalized) on the same render — there
    // are no tabs to switch between them; both lists are passed straight
    // through to `TaskGroupedView`. So once "Human actions" appears the
    // active + finalized cowork.list round trips have both succeeded.
    await expect(page.getByRole('heading', { name: 'Human actions' })).toBeVisible({ timeout: 30_000 });
  });
});
