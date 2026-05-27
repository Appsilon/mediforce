import { test, expect } from '../helpers/test-fixtures';
import {
  apiKeyHeaders,
  bearerHeaders,
  setupMultiNamespaceCallers,
  type MultiNamespaceFixture,
} from '../helpers/multi-namespace';

/**
 * L3 API E2E for the two migrated agent endpoints:
 *   - GET /api/agents          → list, visibility-filtered per caller
 *   - GET /api/agents/[id]     → single, 404 anti-enum for private
 *
 * The seed has:
 *   - `claude-code-agent` (visibility: public, no namespace)
 *   - `mcp-test-agent`    (private — no explicit visibility, defaults; namespace=test)
 *   - `oauth-test-agent`  (private, namespace=test)
 *
 * The outsider user is not a member of `test`, so they should see only the
 * public agent in the list and 404 on the private ones.
 */

test.describe('GET /api/agents — API E2E', () => {
  // ADR-0001 PR2: depends on Firestore-seeded agent fixtures.
  // Postgres seed parity ships with postgres-seed extension pass.
  test.skip(
    process.env.STORAGE_BACKEND === 'postgres',
    'Requires Firestore-seeded agents; Postgres seed parity ships later in PR2',
  );

  let callers: MultiNamespaceFixture;

  test.beforeAll(async () => {
    callers = await setupMultiNamespaceCallers();
  });

  test('list: api-key caller sees every seeded agent', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: apiKeyHeaders(),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string }> };
    const ids = body.agents.map((agent) => agent.id);
    expect(ids).toEqual(expect.arrayContaining([
      'claude-code-agent',
      'mcp-test-agent',
      'oauth-test-agent',
    ]));
  });

  test('list: outsider user sees only public agents (not the `test`-private ones)', async ({ request }) => {
    const res = await request.get('/api/agents', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agents: Array<{ id: string; visibility?: string }> };
    const ids = body.agents.map((agent) => agent.id);
    expect(ids).toContain('claude-code-agent');
    // Private agents belonging to namespace `test` must be filtered out.
    expect(ids).not.toContain('mcp-test-agent');
    expect(ids).not.toContain('oauth-test-agent');
    expect(body.agents.every((agent) => agent.visibility === 'public')).toBe(true);
  });

  test('single: outsider user → 404 on a private agent (anti-enum)', async ({ request }) => {
    const res = await request.get('/api/agents/mcp-test-agent', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status()).toBe(404);
  });

  test('single: outsider user → 200 on a public agent', async ({ request }) => {
    const res = await request.get('/api/agents/claude-code-agent', {
      headers: bearerHeaders(callers.outsider),
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = await res.json() as { agent: { id: string; visibility?: string } };
    expect(body.agent.id).toBe('claude-code-agent');
    expect(body.agent.visibility).toBe('public');
  });
});
