import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  sessionCookieHeaders,
  setupMultiNamespaceCallers,
  TEST_ORG_HANDLE,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for `GET /api/agent-runs` (extended with `status`/`cardStatus`/
 * `processInstanceId` filters + cursor pagination) and the new
 * `GET /api/agent-runs/card-status-counts` — the Monitoring → Agents tab's
 * paginated run list and its server-side `AgentRunCardStatus` KPI
 * aggregation.
 *
 * Both endpoints share the `namespace`/`processInstanceIds`/`status` filter
 * axes (`ListAgentRunsInputSchema` / `GetAgentRunCardStatusCountsInputSchema`
 * in `packages/platform-api/src/contract/agent-runs.ts`), so they're
 * covered together.
 *
 * The 4 seeded agent runs (`buildSeedData` → `seed-data.ts`) all belong to
 * the dedicated parent instance `proc-agent-runs-page-journey` — one run per
 * `AgentRunCardStatus` bucket (running/completed/error/flagged). Filtering
 * on `processInstanceId=proc-agent-runs-page-journey` isolates exactly these
 * 4 rows from whatever parallel journeys are doing to other agent runs
 * under the shared `test` namespace, which is what makes the
 * card-status-counts assertions below exact rather than lower-bound.
 */

const PARENT_INSTANCE_ID = 'proc-agent-runs-page-journey';
const RUN_FLAGGED = '00000000-0000-4000-9000-000000000001'; // oldest
const RUN_ERROR = '00000000-0000-4000-9000-000000000002';
const RUN_COMPLETED = '00000000-0000-4000-9000-000000000003';
const RUN_RUNNING = '00000000-0000-4000-9000-000000000004'; // newest

function agentRunsUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams({
    namespace: TEST_ORG_HANDLE,
    processInstanceId: PARENT_INSTANCE_ID,
    ...params,
  });
  return `/api/agent-runs?${search.toString()}`;
}

function cardStatusCountsUrl(params: Record<string, string> = {}): string {
  const search = new URLSearchParams({
    namespace: TEST_ORG_HANDLE,
    processInstanceId: PARENT_INSTANCE_ID,
    ...params,
  });
  return `/api/agent-runs/card-status-counts?${search.toString()}`;
}

test.describe('GET /api/agent-runs — API E2E (paginated + filtered)', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller: 200 with all 4 seeded runs, newest-first by startedAt', async ({ request }) => {
    const res = await request.get(agentRunsUrl(), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as { runs: Array<{ id: string; processInstanceId: string }>; nextCursor?: string };
    expect(body.runs.map((run) => run.id)).toEqual([RUN_RUNNING, RUN_COMPLETED, RUN_ERROR, RUN_FLAGGED]);
    expect(body.nextCursor).toBeUndefined();
    for (const run of body.runs) {
      expect(run.processInstanceId).toBe(PARENT_INSTANCE_ID);
    }
  });

  test('cursor pagination: limit=2 walks all 4 rows across 2 pages with no duplicates, last page has no nextCursor', async ({ request }) => {
    const page1Res = await request.get(agentRunsUrl({ limit: '2' }), { headers: apiKeyHeaders() });
    expect(page1Res.status(), await page1Res.text()).toBe(200);
    const page1 = (await page1Res.json()) as { runs: Array<{ id: string }>; nextCursor?: string };
    expect(page1.runs.map((run) => run.id)).toEqual([RUN_RUNNING, RUN_COMPLETED]);
    expect(page1.nextCursor).toBeDefined();

    const page2Res = await request.get(agentRunsUrl({ limit: '2', cursor: page1.nextCursor! }), {
      headers: apiKeyHeaders(),
    });
    expect(page2Res.status(), await page2Res.text()).toBe(200);
    const page2 = (await page2Res.json()) as { runs: Array<{ id: string }>; nextCursor?: string };
    expect(page2.runs.map((run) => run.id)).toEqual([RUN_ERROR, RUN_FLAGGED]);
    expect(page2.nextCursor).toBeUndefined();

    const seenIds = [...page1.runs, ...page2.runs].map((run) => run.id);
    expect(new Set(seenIds).size).toBe(seenIds.length);
  });

  test('cardStatus filter narrows to the matching bucket only', async ({ request }) => {
    const res = await request.get(agentRunsUrl({ cardStatus: 'flagged' }), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((run) => run.id)).toEqual([RUN_FLAGGED]);
  });

  test('status filter (raw AgentRunStatus) narrows to the matching run only', async ({ request }) => {
    const res = await request.get(agentRunsUrl({ status: 'running' }), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string }> };
    expect(body.runs.map((run) => run.id)).toEqual([RUN_RUNNING]);
  });

  test('non-member caller with explicit namespace: empty list, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(agentRunsUrl(), { headers: sessionCookieHeaders(callers.outsider) });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: unknown[] };
    expect(body.runs).toEqual([]);
  });
});

test.describe('GET /api/agent-runs/card-status-counts — API E2E', () => {
  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('api-key caller: exact per-bucket counts scoped to the fixture parent instance', async ({ request }) => {
    const res = await request.get(cardStatusCountsUrl(), { headers: apiKeyHeaders() });
    expect(res.status(), await res.text()).toBe(200);

    const body = (await res.json()) as {
      counts: { total: number; running: number; completed: number; error: number; flagged: number };
    };
    expect(body.counts).toEqual({ total: 4, running: 1, completed: 1, error: 1, flagged: 1 });
  });

  test('non-member caller with explicit namespace: zero counts, NOT a 403 (intersection semantics)', async ({ request }) => {
    const res = await request.get(cardStatusCountsUrl(), { headers: sessionCookieHeaders(callers.outsider) });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as {
      counts: { total: number; running: number; completed: number; error: number; flagged: number };
    };
    expect(body.counts).toEqual({ total: 0, running: 0, completed: 0, error: 0, flagged: 0 });
  });
});
