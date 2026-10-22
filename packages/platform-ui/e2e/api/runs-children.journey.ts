import { test, expect } from '../helpers/test-fixtures';
import {
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for `GET /api/runs?parent=<runId>` — the runs one run spawned,
 * which the canvas draws inside an expanded spawn / run-workflow step.
 *
 * The seeded parent (`proc-runs-children-parent`, `buildSeedData` →
 * `seed-data.ts`) has two children, the newer one seeded first, so the order
 * assertion proves the oldest-first sort rather than insertion order.
 */

const PARENT_ID = 'proc-runs-children-parent';
const OLDER_CHILD_ID = 'proc-runs-children-older';
const NEWER_CHILD_ID = 'proc-runs-children-newer';

test.describe('GET /api/runs?parent= — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('member: 200 with only the parent’s children, oldest first', async ({ request }) => {
    const res = await request.get(`/api/runs?parent=${PARENT_ID}`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: Array<{ id: string; parentInstanceId?: string }> };
    expect(body.runs.map((run) => run.id)).toEqual([OLDER_CHILD_ID, NEWER_CHILD_ID]);
    for (const run of body.runs) {
      expect(run.parentInstanceId).toBe(PARENT_ID);
    }
  });

  test('limit does not cut a parent’s children short', async ({ request }) => {
    const res = await request.get(`/api/runs?parent=${PARENT_ID}&limit=1`, {
      headers: sessionCookieHeaders(callers.member),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: Array<{ id: string }> };
    expect(body.runs.map((run) => run.id)).toEqual([OLDER_CHILD_ID, NEWER_CHILD_ID]);
  });

  test('caller outside the children’s namespace: empty list, NOT a 403', async ({ request }) => {
    const res = await request.get(`/api/runs?parent=${PARENT_ID}`, {
      headers: sessionCookieHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);

    const body = await res.json() as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });
});
