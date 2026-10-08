import { test, expect } from '../helpers/test-fixtures';
import { TEST_ORG_HANDLE } from '../helpers/constants';

/**
 * L3 API journey for the tool-catalog admin endpoints. Runs against
 * Postgres: route handler → AuthorizedToolCatalogRepository →
 * PostgresToolCatalogRepository → Drizzle → live Postgres container.
 */
test.describe('tool-catalog admin API journey', () => {
  const apiKey = process.env.PLATFORM_API_KEY ?? 'test-api-key';
  const authHeaders = { 'X-Api-Key': apiKey };

  test('CRUD round-trip survives a fresh GET', async ({ request }) => {
    const entryId = `e2e-tool-${Date.now()}`;
    const payload = {
      id: entryId,
      type: 'stdio',
      command: 'echo',
      args: ['--hello'],
      env: { TOKEN: '{{SECRET:token}}' },
      description: 'L3 round-trip',
    };

    const createRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: payload },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);
    const created = (await createRes.json()) as { entry: typeof payload };
    expect(created.entry).toEqual(payload);

    const listRes = await request.get(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(listRes.ok(), await listRes.text()).toBe(true);
    const list = (await listRes.json()) as { entries: Array<{ id: string }> };
    expect(list.entries.map((e) => e.id)).toContain(entryId);

    const dupRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: payload },
    );
    expect(dupRes.status()).toBe(409);

    const deleteRes = await request.delete(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(deleteRes.ok(), await deleteRes.text()).toBe(true);

    const afterDelete = await request.get(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    const remaining = (await afterDelete.json()) as { entries: Array<{ id: string }> };
    expect(remaining.entries.map((e) => e.id)).not.toContain(entryId);
  });

  test('a PATCH clears the optional fields sent as null and keeps the ones left out', async ({ request }) => {
    const entryId = `e2e-clear-tool-${Date.now()}`;

    const createRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      {
        headers: authHeaders,
        data: { id: entryId, command: 'echo', args: ['--hello'], env: { TOKEN: 'x' }, description: 'kept' },
      },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);

    const clearRes = await request.patch(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: { args: null, env: null } },
    );
    expect(clearRes.ok(), await clearRes.text()).toBe(true);

    const getRes = await request.get(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(getRes.ok(), await getRes.text()).toBe(true);
    const fetched = (await getRes.json()) as { entry: Record<string, unknown> };
    expect(fetched.entry).toEqual({ id: entryId, type: 'stdio', command: 'echo', description: 'kept' });

    const clearDescriptionRes = await request.patch(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: { description: null } },
    );
    expect(clearDescriptionRes.ok(), await clearDescriptionRes.text()).toBe(true);
    const afterDescription = await request.get(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    const cleared = (await afterDescription.json()) as { entry: Record<string, unknown> };
    expect(cleared.entry).toEqual({ id: entryId, type: 'stdio', command: 'echo' });

    await request.delete(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
  });

  test('an HTTP server round-trips and is the only thing an agent can bind to', async ({ request }) => {
    const entryId = `e2e-http-${Date.now()}`;
    const entry = {
      id: entryId,
      type: 'http',
      url: 'https://mcp.example.com/mcp',
      auth: { type: 'headers', headers: { Authorization: 'Bearer {{SECRET:token}}' } },
      description: 'L3 http',
    };

    const createRes = await request.post(
      `/api/admin/tool-catalog?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: entry },
    );
    expect(createRes.status(), await createRes.text()).toBe(201);

    const patchRes = await request.patch(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: { url: 'https://mcp.example.com/v2', auth: null } },
    );
    expect(patchRes.ok(), await patchRes.text()).toBe(true);
    const getRes = await request.get(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders },
    );
    expect(((await getRes.json()) as { entry: unknown }).entry).toEqual({
      id: entryId,
      type: 'http',
      url: 'https://mcp.example.com/v2',
      description: 'L3 http',
    });

    const commandOnHttp = await request.patch(
      `/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: { command: 'echo' } },
    );
    expect(commandOnHttp.status()).toBe(400);

    const agentRes = await request.post('/api/agents', {
      headers: authHeaders,
      data: {
        name: `HTTP binder ${entryId}`,
        iconName: 'Bot',
        description: 'Binds a catalog HTTP server',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'p',
        inputDescription: 'i',
        outputDescription: 'o',
        namespace: TEST_ORG_HANDLE,
      },
    });
    expect(agentRes.status(), await agentRes.text()).toBe(201);
    const { agent } = (await agentRes.json()) as { agent: { id: string } };

    const bindRes = await request.put(`/api/agents/${agent.id}/mcp-servers/remote`, {
      headers: authHeaders,
      data: { type: 'http', catalogId: entryId },
    });
    expect(bindRes.ok(), await bindRes.text()).toBe(true);

    const unknownRes = await request.put(`/api/agents/${agent.id}/mcp-servers/ghost`, {
      headers: authHeaders,
      data: { type: 'http', catalogId: `${entryId}-missing` },
    });
    expect(unknownRes.status()).toBe(400);

    const inlineRes = await request.put(`/api/agents/${agent.id}/mcp-servers/inline`, {
      headers: authHeaders,
      data: { type: 'http', url: 'https://mcp.example.com/mcp' },
    });
    expect(inlineRes.status()).toBe(400);

    await request.delete(`/api/agents/${agent.id}`, { headers: authHeaders });
    await request.delete(`/api/admin/tool-catalog/${entryId}?namespace=${TEST_ORG_HANDLE}`, { headers: authHeaders });
  });

  test('discover rejects private targets and unauthenticated callers', async ({ request }) => {
    const privateRes = await request.post(
      `/api/admin/tool-catalog/discover?namespace=${TEST_ORG_HANDLE}`,
      { headers: authHeaders, data: { type: 'http', url: 'http://169.254.169.254/latest' } },
    );
    expect(privateRes.status(), await privateRes.text()).toBe(400);

    const unauthRes = await request.post(
      `/api/admin/tool-catalog/discover?namespace=${TEST_ORG_HANDLE}`,
      { data: { type: 'http', url: 'https://mcp.example.com/mcp' } },
    );
    expect(unauthRes.status()).toBe(401);
  });
});
