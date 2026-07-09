import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WorkflowDefinition } from '@mediforce/platform-core';

const fake = vi.hoisted(() => {
  const definitions: WorkflowDefinition[] = [];

  const services = {
    namespaceRepo: {
      getNamespacesByUser: async (_uid: string) => [
        { handle: 'acme' },
        { handle: 'beta' },
      ],
      getMembershipsForUser: async (_uid: string) => [
        { handle: 'acme', role: 'member' as const },
        { handle: 'beta', role: 'member' as const },
      ],
    },
    processRepo: {
      listAllWorkflowDefinitions: async () => {
        const grouped = new Map<string, WorkflowDefinition[]>();
        for (const d of definitions) {
          const key = `${d.namespace}:${d.name}`;
          const existing = grouped.get(key) ?? [];
          existing.push(d);
          grouped.set(key, existing);
        }
        return {
          definitions: Array.from(grouped.entries()).map(([_key, versions]) => {
            const namespace = versions[0].namespace;
            const name = versions[0].name;
            return {
              namespace,
              name,
              versions,
              latestVersion: Math.max(...versions.map((v) => v.version)),
              defaultVersion: null,
            };
          }),
        };
      },
    },
  };

  return { definitions, services };
});

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => fake.services,
}));

vi.mock('@mediforce/platform-infra', () => ({
  getAdminAuth: () => ({
    verifyIdToken: async () => ({ uid: 'user-1' }),
  }),
}));

import { GET } from '@/app/api/workflow-definitions/by-image/route';

function makeWorkflow(
  overrides: Partial<WorkflowDefinition> & { name: string; namespace: string; version: number },
  images: string[],
): WorkflowDefinition {
  return {
    visibility: 'private',
    steps: images.map((img, i) => ({
      id: `step-${i}`,
      name: `Step ${i}`,
      type: 'creation' as const,
      executor: 'agent' as const,
      agent: { image: img },
    })),
    transitions: [],
    triggers: [{ type: 'manual' }],
    ...overrides,
  } as WorkflowDefinition;
}

function req(image: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/workflow-definitions/by-image?image=${encodeURIComponent(image)}`,
    { headers: { Authorization: 'Bearer valid-token' } },
  );
}

describe('GET /api/workflow-definitions/by-image', () => {
  beforeEach(() => {
    fake.definitions.length = 0;
  });

  it('returns 400 when image param missing', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/workflow-definitions/by-image', {
        headers: { Authorization: 'Bearer valid-token' },
      }),
    );
    expect(res.status).toBe(400);
  });

  it('returns workflows matching exact image reference', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-a', namespace: 'acme', version: 1 }, ['myimage:v1']),
      makeWorkflow({ name: 'wf-b', namespace: 'acme', version: 1 }, ['other:v2']),
    );

    const res = await GET(req('myimage:v1'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-a');
  });

  it('normalizes tagless image to :latest for matching', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-c', namespace: 'acme', version: 1 }, ['myimage:latest']),
    );

    const res = await GET(req('myimage'));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-c');
  });

  it('normalizes tagless workflow image ref to :latest', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-d', namespace: 'acme', version: 1 }, ['myimage']),
    );

    const res = await GET(req('myimage:latest'));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-d');
  });

  it('filters out workflows from namespaces user cannot access', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-visible', namespace: 'acme', version: 1 }, ['img:v1']),
      makeWorkflow({ name: 'wf-hidden', namespace: 'secret-corp', version: 1 }, ['img:v1']),
    );

    const res = await GET(req('img:v1'));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-visible');
  });

  it('includes public workflows from other namespaces', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-pub', namespace: 'other-ns', version: 1, visibility: 'public' }, ['img:v1']),
    );

    const res = await GET(req('img:v1'));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-pub');
  });

  it('uses only latest version per workflow for matching', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-e', namespace: 'acme', version: 1 }, ['old-img:v1']),
      makeWorkflow({ name: 'wf-e', namespace: 'acme', version: 2 }, ['new-img:v2']),
    );

    const res1 = await GET(req('old-img:v1'));
    const body1 = await res1.json();
    expect(body1.workflows).toHaveLength(0);

    const res2 = await GET(req('new-img:v2'));
    const body2 = await res2.json();
    expect(body2.workflows).toHaveLength(1);
    expect(body2.workflows[0].name).toBe('wf-e');
  });

  it('returns matching step ids in response', async () => {
    fake.definitions.push(
      makeWorkflow(
        { name: 'wf-f', namespace: 'acme', version: 1 },
        ['target:v1', 'other:v2', 'target:v1'],
      ),
    );

    const res = await GET(req('target:v1'));
    const body = await res.json();

    expect(body.workflows[0].steps).toEqual(['step-0', 'step-2']);
  });

  it('returns 401 without auth header', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/workflow-definitions/by-image?image=x:y'),
    );
    expect(res.status).toBe(401);
  });
});
