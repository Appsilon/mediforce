import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListWorkflowDefinitions = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: { listWorkflowDefinitions: mockListWorkflowDefinitions },
    namespaceRepo: {},
  }),
}));

const mockResolveCallerIdentity = vi.fn();

vi.mock('@/lib/api-auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api-auth')>('@/lib/api-auth');
  return {
    ...actual,
    resolveCallerIdentity: (...args: unknown[]) => mockResolveCallerIdentity(...args),
  };
});

import { GET } from '../route';

function makeRequest(url = 'http://localhost/api/workflow-definitions') {
  return new Request(url, { headers: { 'X-Api-Key': 'test-key' } });
}

describe('GET /api/workflow-definitions', () => {
  beforeEach(() => {
    mockListWorkflowDefinitions.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns visible workflow definitions wrapped in { definitions }', async () => {
    mockListWorkflowDefinitions.mockResolvedValue({
      definitions: [
        {
          namespace: 'team-alpha',
          name: 'flow-a',
          versions: [
            {
              name: 'flow-a',
              version: 1,
              namespace: 'team-alpha',
              visibility: 'public',
              steps: [],
              transitions: [],
              triggers: [],
            },
          ],
          latestVersion: 1,
          defaultVersion: 1,
        },
      ],
    });

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definitions).toHaveLength(1);
    expect(body.definitions[0].name).toBe('flow-a');
  });

  it('[AUTH] filters out private workflows the user cannot see', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['team-beta']),
    });
    mockListWorkflowDefinitions.mockResolvedValue({
      definitions: [
        {
          namespace: 'team-alpha',
          name: 'flow-private',
          versions: [
            {
              name: 'flow-private',
              version: 1,
              namespace: 'team-alpha',
              visibility: 'private',
              steps: [],
              transitions: [],
              triggers: [],
            },
          ],
          latestVersion: 1,
          defaultVersion: null,
        },
      ],
    });

    const res = await GET(makeRequest(), undefined);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definitions).toEqual([]);
  });
});
