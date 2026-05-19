import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetLatestWorkflowVersion = vi.fn();
const mockGetWorkflowDefinition = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    processRepo: {
      getLatestWorkflowVersion: mockGetLatestWorkflowVersion,
      getWorkflowDefinition: mockGetWorkflowDefinition,
    },
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

function makeRequest(name: string, query = '') {
  const req = new Request(`http://localhost/api/workflow-definitions/${name}${query}`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ name }) };
}

const publicWorkflow = {
  name: 'flow-a',
  version: 1,
  namespace: 'team-alpha',
  visibility: 'public' as const,
  steps: [],
  transitions: [],
  triggers: [],
};

const privateWorkflow = {
  ...publicWorkflow,
  name: 'flow-private',
  visibility: 'private' as const,
};

describe('GET /api/workflow-definitions/[name]', () => {
  beforeEach(() => {
    mockGetLatestWorkflowVersion.mockReset();
    mockGetWorkflowDefinition.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
  });

  it('[DATA] returns the latest version wrapped in { definition }', async () => {
    mockGetLatestWorkflowVersion.mockResolvedValue(1);
    mockGetWorkflowDefinition.mockResolvedValue(publicWorkflow);
    const { req, params } = makeRequest('flow-a');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.definition.name).toBe('flow-a');
  });

  it('[ERROR] returns 404 when no version exists', async () => {
    mockGetLatestWorkflowVersion.mockResolvedValue(0);
    const { req, params } = makeRequest('missing');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it('[AUTH] returns 404 (not 403) when user reads a private workflow outside their namespace', async () => {
    // Anti-enumeration: visibility-denied looks identical on the wire to
    // not-found.
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['team-beta']),
    });
    mockGetLatestWorkflowVersion.mockResolvedValue(1);
    mockGetWorkflowDefinition.mockResolvedValue(privateWorkflow);
    const { req, params } = makeRequest('flow-private', '?namespace=team-alpha');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });
});
