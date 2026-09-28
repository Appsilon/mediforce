import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import type { WorkflowDefinition } from '@mediforce/platform-core';

const fake = vi.hoisted(() => {
  const definitions: WorkflowDefinition[] = [];
  /** `namespace:name` -> pinned default version, for the liveness tests. */
  const defaultVersions = new Map<string, number>();

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
      // Honours `includeArchived` and the default-version map, because both
      // decide which pins the route reports and whether they count as live.
      listAllWorkflowDefinitions: async (includeArchived: boolean) => {
        const grouped = new Map<string, WorkflowDefinition[]>();
        for (const d of definitions) {
          if (includeArchived !== true && d.archived === true) continue;
          const key = `${d.namespace}:${d.name}`;
          const existing = grouped.get(key) ?? [];
          existing.push(d);
          grouped.set(key, existing);
        }
        return {
          definitions: Array.from(grouped.entries()).map(([key, versions]) => {
            const namespace = versions[0].namespace;
            const name = versions[0].name;
            return {
              namespace,
              name,
              versions,
              latestVersion: Math.max(...versions.map((v) => v.version)),
              defaultVersion: defaultVersions.get(key) ?? null,
            };
          }),
        };
      },
    },
  };

  return { definitions, defaultVersions, services };
});

vi.mock('@/lib/platform-services', () => ({
  getPlatformServices: () => fake.services,
}));

vi.mock('@mediforce/platform-infra', () => ({
  getSharedPostgresClient: () => ({ db: {} }),
  resolveSessionUserId: async () => 'user-1',
  // `resolveCallerIdentity` resolves the caller's process roles alongside
  // their memberships (ADR-0019). No route under test reads them, so an
  // empty map is the honest stub.
  getWorkspaceProcessRoles: async () => new Map(),
}));

import { deriveBuildTag } from '@mediforce/agent-runtime';
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
    ...overrides,
  } as WorkflowDefinition;
}

function req(...images: string[]): NextRequest {
  const query = images.map((image) => `image=${encodeURIComponent(image)}`).join('&');
  return new NextRequest(
    `http://localhost/api/workflow-definitions/by-image?${query}`,
    { headers: { cookie: 'authjs.session-token=tok-123' } },
  );
}

describe('GET /api/workflow-definitions/by-image', () => {
  beforeEach(() => {
    fake.definitions.length = 0;
    fake.defaultVersions.clear();
  });

  it('returns 400 when image param missing', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/workflow-definitions/by-image', {
        headers: { cookie: 'authjs.session-token=tok-123' },
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

  it('answers for several images at once, naming which ones each workflow uses', async () => {
    // One catalog entry accumulates a version per build, and the Images view
    // asks about all of them together: a call per version would be a full scan
    // of every workflow definition per version.
    fake.definitions.push(
      makeWorkflow({ name: 'wf-old', namespace: 'acme', version: 1 }, ['img:v1']),
      makeWorkflow({ name: 'wf-new', namespace: 'acme', version: 1 }, ['img:v2']),
      makeWorkflow({ name: 'wf-elsewhere', namespace: 'acme', version: 1 }, ['other:v9']),
    );

    const res = await GET(req('img:v1', 'img:v2'));
    const body = await res.json();

    expect(body.workflows.map((w: { name: string }) => w.name).sort()).toEqual([
      'wf-new',
      'wf-old',
    ]);
    expect(body.workflows.find((w: { name: string }) => w.name === 'wf-old').images).toEqual([
      'img:v1',
    ]);
  });

  it('reports every requested image a single workflow uses, so an unused version is visible', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'wf-both', namespace: 'acme', version: 1 }, ['img:v1', 'img:v2']),
    );

    const res = await GET(req('img:v1', 'img:v2', 'img:v3'));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].images).toEqual(['img:v1', 'img:v2']);
  });

  it('matches a build-mode step that omits image, under its derived tag', async () => {
    // The reuse-blind case: no `image` to compare against, so the row on the
    // infrastructure page is a bare `mediforce-built:<hash>` naming nothing.
    fake.definitions.push({
      name: 'wf-built',
      namespace: 'acme',
      version: 1,
      visibility: 'private',
      steps: [
        {
          id: 'build-step',
          name: 'Build step',
          type: 'creation',
          executor: 'agent',
          agent: { repo: 'org/repo', commit: 'abc1234', dockerfile: 'container/Dockerfile' },
        },
      ],
      transitions: [],
    } as unknown as WorkflowDefinition);

    const derived = deriveBuildTag('git@github.com:org/repo.git', 'abc1234', 'container/Dockerfile');
    const res = await GET(req(derived));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-built');
    expect(body.workflows[0].steps).toEqual(['build-step']);
  });

  it('matches a step that inherits the build repo from the workflow', async () => {
    fake.definitions.push({
      name: 'wf-inherited',
      namespace: 'acme',
      version: 1,
      visibility: 'private',
      externalSkillsRepo: { url: 'git@github.com:org/skills.git', commit: 'def5678' },
      steps: [
        {
          id: 'script-step',
          name: 'Script step',
          type: 'creation',
          executor: 'script',
          script: { command: 'run.sh', dockerfile: 'Dockerfile' },
        },
      ],
      transitions: [],
    } as unknown as WorkflowDefinition);

    const derived = deriveBuildTag('git@github.com:org/skills.git', 'def5678', 'Dockerfile');
    const res = await GET(req(derived));
    const body = await res.json();

    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].name).toBe('wf-inherited');
  });

  it('returns 401 without auth header', async () => {
    const res = await GET(
      new NextRequest('http://localhost/api/workflow-definitions/by-image?image=x:y'),
    );
    expect(res.status).toBe(401);
  });

  it('reports only the live version by default', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 2 }, ['tealflow:v9']),
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 1 }, ['tealflow:v9']),
    );

    const body = (await (await GET(req('tealflow:v9'))).json()) as {
      workflows: { version: number; live: boolean }[];
    };

    // A superseded version is not a workflow anybody runs, so "used by" stays
    // the narrow answer it always was.
    expect(body.workflows).toHaveLength(1);
    expect(body.workflows[0].version).toBe(2);
    expect(body.workflows[0].live).toBe(true);
  });

  it('reports every version, archived included, under scope=all', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 3 }, ['tealflow:v9']),
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 1 }, ['tealflow:v9']),
      makeWorkflow({ name: 'old', namespace: 'acme', version: 1, archived: true }, [
        'tealflow:v9',
      ]),
    );

    const res = await GET(
      new NextRequest(
        'http://localhost/api/workflow-definitions/by-image?image=tealflow%3Av9&scope=all',
        { headers: { cookie: 'authjs.session-token=tok-123' } },
      ),
    );
    const body = (await res.json()) as {
      workflows: { name: string; version: number; live: boolean; archived: boolean }[];
    };

    // The wide answer is what a reader needs before destroying an artifact:
    // the narrow one hides the history it would take with it.
    expect(body.workflows).toHaveLength(3);
    expect(body.workflows.find((w) => w.version === 1 && w.name === 'qc')?.live).toBe(false);
    const archived = body.workflows.find((w) => w.name === 'old');
    expect(archived?.archived).toBe(true);
    expect(archived?.live).toBe(false);
  });

  it('treats the default version as live, not the newest', async () => {
    fake.definitions.push(
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 3 }, ['tealflow:v9']),
      makeWorkflow({ name: 'qc', namespace: 'acme', version: 2 }, ['tealflow:v9']),
    );
    fake.defaultVersions.set('acme:qc', 2);

    const body = (await (await GET(req('tealflow:v9'))).json()) as {
      workflows: { version: number }[];
    };

    // A run starts from the default version; the newest may be a draft nobody
    // runs, which the old latest-only scan reported instead.
    expect(body.workflows.map((w) => w.version)).toEqual([2]);
  });
});
