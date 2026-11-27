import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API E2E for orchestrator cost rollup (PR #1711 review): `treeCostUsd`
 * (own + every descendant's, recursively) must read the same on a single
 * run (`GET /api/runs/<id>`) and in a list (`GET /api/runs/page`) — the
 * exact parity the review flagged as a non-deferrable regression.
 *
 * Seeded fixture (`seed-data.ts`): a 3-level chain, root -> mid -> leaf, each
 * with its own `totalCostUsd` and a `treeCostUsd` that already includes every
 * descendant. Values are seeded directly (no spawn/run-workflow execution) —
 * the accumulation + ancestor-chain walk itself is covered by the
 * `agent-step-executor.test.ts` unit tests; this only proves the read path.
 */

const API_KEY = process.env.PLATFORM_API_KEY ?? 'test-api-key';
const HEADERS = { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' };

const ROOT_ID = 'proc-cost-rollup-root';
const ROOT_OWN_COST = 0.1;
const ROOT_TREE_COST = 0.6; // 0.1 (root) + 0.2 (mid) + 0.3 (leaf)

test.describe('Orchestrator cost rollup — API E2E', () => {
  test('root run reports own cost and whole-tree cost', async ({ request }) => {
    const res = await request.get(`/api/runs/${ROOT_ID}`, { headers: HEADERS });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { totalCostUsd?: number; treeCostUsd?: number };
    expect(body.totalCostUsd).toBe(ROOT_OWN_COST);
    expect(body.treeCostUsd).toBe(ROOT_TREE_COST);
  });

  test('the run list reports the same treeCostUsd as the single-run read', async ({ request }) => {
    const search = new URLSearchParams({ namespace: TEST_ORG_HANDLE, workflow: 'Cost Rollup Journey Workflow' });
    const res = await request.get(`/api/runs/page?${search.toString()}`, { headers: HEADERS });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { runs: Array<{ id: string; treeCostUsd?: number }> };
    const root = body.runs.find((run) => run.id === ROOT_ID);
    expect(root?.treeCostUsd).toBe(ROOT_TREE_COST);
  });
});
