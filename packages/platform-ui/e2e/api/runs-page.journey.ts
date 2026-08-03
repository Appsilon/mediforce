import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for `GET /api/runs/page` and `GET /api/runs/status-counts` —
 * the Monitoring → Workflows tab's cursor-paginated run list and its
 * server-side `WorkflowDisplayStatus` KPI aggregation.
 *
 * Both endpoints share the `namespace`/`workflow`/`dryRun`/`archived` filter
 * axes (`ListRunsPageInputSchema` / `GetWorkflowStatusCountsInputSchema` in
 * `packages/platform-api/src/contract/runs.ts`), so they're covered
 * together. `namespace` is optional on both schemas (unlike `/api/runs/names`),
 * so the anti-enumeration probe below explicitly passes the shared `test`
 * namespace rather than relying on an implicit default.
 *
 * The seeded runs (`buildSeedData` → `seed-data.ts`) all carry the unique
 * `definitionName: 'Runs Page Journey Workflow'`, so filtering on `workflow`
 * isolates exactly these 5 rows — one per `WorkflowDisplayStatus` bucket —
 * from whatever parallel journeys are doing to other runs under the shared
 * `test` namespace. That's what makes the status-counts assertions below
 * exact rather than lower-bound.
 */

const WORKFLOW_NAME = 'Runs Page Journey Workflow';
const RUN_COMPLETED = 'proc-runs-page-journey-1'; // oldest
const RUN_IN_PROGRESS = 'proc-runs-page-journey-2';
const RUN_WAITING = 'proc-runs-page-journey-3';
const RUN_CANCELLED = 'proc-runs-page-journey-4';
const RUN_ERROR = 'proc-runs-page-journey-5'; // newest

function runsPageUrl(params: Record<string, string>): string {
  const search = new URLSearchParams({ namespace: TEST_ORG_HANDLE, workflow: WORKFLOW_NAME, ...params });
  return `/api/runs/page?${search.toString()}`;
}

function statusCountsUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ namespace: TEST_ORG_HANDLE, workflow: WORKFLOW_NAME, ...params });
  return `/api/runs/status-counts?${search.toString()}`;
}

test.describe('GET /api/runs/page — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller: 200 with all 5 seeded runs, newest-first by createdAt', async ({ request }) => {
    const res = await request.get(runsPageUrl({}), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as { runs: Array<{ id: string; namespace?: string; status: string }>; nextCursor?: string };
    expect(Array.isArray(body.runs)).toBe(true);
    expect(body.runs.map((run) => run.id)).toEqual([
      RUN_ERROR,
      RUN_CANCELLED,
      RUN_WAITING,
      RUN_IN_PROGRESS,
      RUN_COMPLETED,
    ]);
    expect(body.nextCursor).toBeUndefined();
    for (const run of body.runs) {
      expect(run.namespace).toBe(TEST_ORG_HANDLE);
    }
  });

  test('cursor pagination: limit=2 walks all 5 rows across 3 pages with no duplicates, last page has no nextCursor', async ({ request }) => {
    const page1Res = await request.get(runsPageUrl({ limit: '2' }), { headers: apiKeyHeaders() });
    expect(page1Res.status(), await page1Res.text()).toBe(200);
    const page1 = (await page1Res.json()) as { runs: Array<{ id: string }>; nextCursor?: string };
    expect(page1.runs.map((run) => run.id)).toEqual([RUN_ERROR, RUN_CANCELLED]);
    expect(page1.nextCursor).toBeDefined();

    const page2Res = await request.get(runsPageUrl({ limit: '2', cursor: page1.nextCursor! }), {
      headers: apiKeyHeaders(),
    });
    expect(page2Res.status(), await page2Res.text()).toBe(200);
    const page2 = (await page2Res.json()) as { runs: Array<{ id: string }>; nextCursor?: string };
    expect(page2.runs.map((run) => run.id)).toEqual([RUN_WAITING, RUN_IN_PROGRESS]);
    expect(page2.nextCursor).toBeDefined();

    const page3Res = await request.get(runsPageUrl({ limit: '2', cursor: page2.nextCursor! }), {
      headers: apiKeyHeaders(),
    });
    expect(page3Res.status(), await page3Res.text()).toBe(200);
    const page3 = (await page3Res.json()) as { runs: Array<{ id: string }>; nextCursor?: string };
    expect(page3.runs.map((run) => run.id)).toEqual([RUN_COMPLETED]);
    expect(page3.nextCursor).toBeUndefined();

    const seenIds = [...page1.runs, ...page2.runs, ...page3.runs].map((run) => run.id);
    expect(new Set(seenIds).size).toBe(seenIds.length);
  });

  test('displayStatus filter narrows to the matching bucket only', async ({ request }) => {
    const res = await request.get(runsPageUrl({ displayStatus: 'waiting_for_human' }), {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((run) => run.id)).toEqual([RUN_WAITING]);
  });

  test('non-member caller with explicit namespace: empty list, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(runsPageUrl({}), { headers: sessionCookieHeaders(callers.outsider) });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });
});

test.describe('GET /api/runs/status-counts — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller: exact per-bucket counts scoped to the fixture workflow', async ({ request }) => {
    const res = await request.get(statusCountsUrl(), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      counts: {
        in_progress: number;
        waiting_for_human: number;
        error: number;
        cancelled: number;
        completed: number;
      };
    };
    expect(body.counts).toEqual({
      in_progress: 1,
      waiting_for_human: 1,
      error: 1,
      cancelled: 1,
      completed: 1,
    });
  });

  test('non-member caller with explicit namespace: zero counts, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(statusCountsUrl(), { headers: sessionCookieHeaders(callers.outsider) });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      counts: { in_progress: number; waiting_for_human: number; error: number; cancelled: number; completed: number };
    };
    expect(body.counts).toEqual({ in_progress: 0, waiting_for_human: 0, error: 0, cancelled: 0, completed: 0 });
  });
});
