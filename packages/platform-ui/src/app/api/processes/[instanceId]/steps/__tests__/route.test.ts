import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockInstanceGetById = vi.fn();
const mockGetStepExecutions = vi.fn();
const mockGetWorkflowDefinition = vi.fn();

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => ({
    instanceRepo: {
      getById: mockInstanceGetById,
      getStepExecutions: mockGetStepExecutions,
    },
    processRepo: {
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

function makeRequest(instanceId: string) {
  const req = new Request(`http://localhost/api/processes/${instanceId}/steps`, {
    headers: { 'X-Api-Key': 'test-key' },
  });
  return { req, params: Promise.resolve({ instanceId }) };
}

describe('GET /api/processes/[instanceId]/steps', () => {
  beforeEach(() => {
    mockInstanceGetById.mockReset();
    mockGetWorkflowDefinition.mockReset();
    mockGetStepExecutions.mockReset();
    mockResolveCallerIdentity.mockReturnValue({ kind: 'apiKey' });
    mockGetStepExecutions.mockResolvedValue([]);
    mockGetWorkflowDefinition.mockResolvedValue({
      name: 'flow-a',
      version: 1,
      namespace: 'team-alpha',
      visibility: 'private',
      steps: [
        { id: 'step-1', name: 'Intake', type: 'creation', executor: 'human' },
      ],
      transitions: [],
      triggers: [{ type: 'manual', name: 'Start' }],
    });
  });

  it('[DATA] returns the steps view for an existing instance', async () => {
    mockInstanceGetById.mockResolvedValue({
      id: 'inst-1',
      namespace: 'team-alpha',
      status: 'running',
      definitionName: 'flow-a',
      definitionVersion: '1',
      variables: {},
      currentStepId: 'step-1',
    });
    const { req, params } = makeRequest('inst-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.steps)).toBe(true);
  });

  it('[ERROR] returns 404 when instance not found', async () => {
    mockInstanceGetById.mockResolvedValue(null);
    const { req, params } = makeRequest('missing');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });

  it('[AUTH] returns 404 (not 403) when user is not a member of the instance namespace (anti-enumeration)', async () => {
    mockResolveCallerIdentity.mockReturnValue({
      kind: 'user',
      uid: 'outsider',
      namespaces: new Set(['other-ns']),
    });
    mockInstanceGetById.mockResolvedValue({
      id: 'inst-1',
      namespace: 'team-alpha',
      status: 'running',
      definitionName: 'flow-a',
      definitionVersion: '1',
      variables: {},
      currentStepId: 'step-1',
    });
    const { req, params } = makeRequest('inst-1');

    const res = await GET(req, { params });

    expect(res.status).toBe(404);
  });
});
