// packages/platform-ui/src/test/api-integration.test.ts
//
// Cross-layer integration: `Mediforce` (client) → adapter → handler →
// `InMemoryHumanTaskRepository`. Loopback fetch ties the layers together
// in process — no HTTP, no `vi.mock` ceremony.
//
// Per-layer tests (contract, handler, adapter, Mediforce class) give fast,
// focused feedback. This file is the representative round-trip — one
// integration per major feature, not per endpoint.

import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import {
  listTasks,
  claimTask,
  cancelRun,
  createNamespace,
  listRuns,
  listAuditEvents,
  updateNamespace,
  leaveNamespace,
} from '@mediforce/platform-api/handlers';
import {
  ListTasksInputSchema,
  ClaimTaskInputSchema,
  CancelRunInputSchema,
  CreateNamespaceInputSchema,
  ListRunsInputSchema,
  ListAuditEventsInputSchema,
  UpdateNamespaceInputSchema,
  LeaveNamespaceInputSchema,
} from '@mediforce/platform-api/contract';
import type {
  UpdateNamespaceInput,
  LeaveNamespaceInput,
} from '@mediforce/platform-api/contract';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { Mediforce, ApiError } from '@mediforce/platform-api/client';
import { createRouteAdapter } from '../../lib/route-adapter';
import { InMemoryNamespaceRepo, createTestScope } from '@mediforce/platform-api/testing';

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

function loopbackFetch(
  route: (req: NextRequest) => Promise<Response>,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
    return route(new NextRequest(absolute, init));
  };
}

describe('Mediforce client ↔ route-adapter ↔ listTasks (in-process)', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest) => Promise<Response>;

  beforeEach(() => {
    humanTaskRepo = new InMemoryHumanTaskRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();

    route = createRouteAdapter(
      ListTasksInputSchema,
      (req) => {
        const p = req.nextUrl.searchParams;
        const statuses = p.getAll('status');
        return {
          instanceId: p.get('instanceId') ?? undefined,
          role: p.get('role') ?? undefined,
          stepId: p.get('stepId') ?? undefined,
          status: statuses.length > 0 ? statuses : undefined,
        };
      },
      listTasks,
      // Stub caller resolution + scope build so the test doesn't pull in
      // Firebase Admin / env-gated services. The wrapper layer is exercised
      // through `createTestScope` with the in-memory repos under test.
      {
        resolveCaller: async () => apiKeyCaller,
        buildScope: (caller) => createTestScope({ caller, humanTaskRepo, instanceRepo }),
      },
    );

    mediforce = new Mediforce({ fetch: loopbackFetch(route) });
  });

  it('round-trips a filtered list through the real adapter, handler and repo', async () => {
    await humanTaskRepo.create(
      buildHumanTask({ id: 't1', processInstanceId: 'inst-a', status: 'pending' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't2', processInstanceId: 'inst-a', status: 'completed' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't3', processInstanceId: 'inst-b', status: 'pending' }),
    );

    const result = await mediforce.tasks.list({
      instanceId: 'inst-a',
      status: ['completed'],
    });

    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0].id).toBe('t2');
  });

  it('surfaces a 400 from the server when contracts drift (both filters set)', async () => {
    const badRequest = new NextRequest(
      'http://localhost/api/tasks?instanceId=foo&role=reviewer',
    );
    const response = await route(badRequest);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe('validation');
    expect(body.error.message).toMatch(/mutually exclusive/i);
  });
});

// Second integration scenario: `claim()` mutation. Covers PR1's specific
// promise that a typed handler throw (`HandlerError` subclass) flows
// end-to-end into a client-side `ApiError` whose `code` /
// `details` fields carry the envelope contents.
describe('Mediforce client ↔ route-adapter ↔ claimTask (in-process)', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest, ctx: { params: Promise<{ taskId: string }> }) => Promise<Response>;
  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-claim-test',
    namespaces: new Set(['team-alpha']),
    namespaceRoles: new Map([['team-alpha', 'member']]),
    isSystemActor: false,
  };

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );

    route = createRouteAdapter<typeof ClaimTaskInputSchema, { taskId: string }, { task: unknown }, { params: Promise<{ taskId: string }> }>(
      ClaimTaskInputSchema,
      async (_req, ctx) => ({ taskId: (await ctx.params).taskId }),
      claimTask,
      {
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, humanTaskRepo, instanceRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const taskId = url.match(/\/api\/tasks\/([^/]+)\/claim/)?.[1] ?? '';
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        return route(new NextRequest(absolute, init), {
          params: Promise.resolve({ taskId: decodeURIComponent(taskId) }),
        });
      },
    });
  });

  it('round-trips claim → returns the entity in `claimed` state with the caller uid', async () => {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-1',
        processInstanceId: 'inst-a',
        status: 'pending',
      }),
    );

    const result = await mediforce.tasks.claim({ taskId: 'task-1' });

    expect(result.task.status).toBe('claimed');
    expect(result.task.assignedUserId).toBe('u-claim-test');
  });

  it('flows a typed `precondition_failed` envelope from handler → adapter → client', async () => {
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-1',
        processInstanceId: 'inst-a',
        status: 'completed',
      }),
    );

    const err = await mediforce.tasks.claim({ taskId: 'task-1' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    const clientErr = err as ApiError;
    expect(clientErr.status).toBe(409);
    expect(clientErr.code).toBe('precondition_failed');
    expect(clientErr.details).toMatchObject({
      taskId: 'task-1',
      currentStatus: 'completed',
    });
  });

  it('returns 404 (anti-enum) for a task in a workspace the caller does not belong to', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-foreign', namespace: 'team-beta' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({
        id: 'task-foreign',
        processInstanceId: 'inst-foreign',
        status: 'pending',
      }),
    );

    const err = await mediforce.tasks
      .claim({ taskId: 'task-foreign' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
    expect((err as ApiError).code).toBe('not_found');
  });
});

// Third integration scenario: `runs.cancel` mutation. One round-trip
// exercising entity-echo response shape + typed envelope surfacing — same
// loopback ceremony as claim above.
describe('Mediforce client ↔ route-adapter ↔ cancelRun (in-process)', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let mediforce: Mediforce;
  let route: (
    req: NextRequest,
    ctx: { params: Promise<{ instanceId: string }> },
  ) => Promise<Response>;
  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-cancel-test',
    namespaces: new Set(['team-alpha']),
    namespaceRoles: new Map([['team-alpha', 'member']]),
    isSystemActor: false,
  };

  beforeEach(() => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);

    route = createRouteAdapter<
      typeof CancelRunInputSchema,
      { runId: string; reason?: string },
      { run: unknown },
      { params: Promise<{ instanceId: string }> }
    >(
      CancelRunInputSchema,
      async (req, ctx) => ({
        runId: (await ctx.params).instanceId,
        ...((await req.json().catch(() => ({}))) as Record<string, unknown>),
      }),
      cancelRun,
      {
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, instanceRepo, humanTaskRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const instanceId = url.match(/\/api\/processes\/([^/]+)\/cancel/)?.[1] ?? '';
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        return route(new NextRequest(absolute, init), {
          params: Promise.resolve({ instanceId: decodeURIComponent(instanceId) }),
        });
      },
    });
  });

  it('round-trips cancel → returns the entity in `failed` state with the reason persisted', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'running' }),
    );

    const result = await mediforce.runs.cancel({ runId: 'inst-a' });

    expect(result.run.id).toBe('inst-a');
    expect(result.run.status).toBe('failed');
    expect(result.run.error).toBe('Cancelled by user');
  });

  it('flows a typed `precondition_failed` envelope for an already-failed run', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha', status: 'failed' }),
    );

    const err = await mediforce.runs
      .cancel({ runId: 'inst-a' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('precondition_failed');
  });
});

// Phase 4 PR4: namespaces.create round-trip — covers the list-affecting
// mutation template (workspaces/new optimistic flow uses this contract).
describe('Mediforce client ↔ route-adapter ↔ createNamespace (in-process)', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest) => Promise<Response>;

  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-create',
    namespaces: new Set(),
    namespaceRoles: new Map(),
    isSystemActor: false,
  };

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    auditRepo = new InMemoryAuditRepository();

    route = createRouteAdapter(
      CreateNamespaceInputSchema,
      async (req) => (await req.json().catch(() => ({}))) as Record<string, unknown>,
      createNamespace,
      {
        successStatus: 201,
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, namespaceRepo, auditRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        return route(new NextRequest(absolute, init));
      },
    });
  });

  it('creates a namespace and round-trips the entity-echo + 201', async () => {
    const result = await mediforce.namespaces.create({
      handle: 'acme',
      displayName: 'Acme Co.',
    });

    expect(result.namespace.handle).toBe('acme');
    expect(result.namespace.type).toBe('organization');
    expect(namespaceRepo.namespaces.get('acme')?.displayName).toBe('Acme Co.');
    expect(namespaceRepo.members.get('acme')?.[0]?.uid).toBe('u-create');
    expect(auditRepo.getAll().some((e) => e.action === 'namespace.created')).toBe(true);
  });

  it('returns a typed `conflict` envelope when the handle is taken', async () => {
    namespaceRepo.namespaces.set('acme', {
      handle: 'acme',
      type: 'organization',
      displayName: 'someone else',
      createdAt: '2026-01-01T00:00:00.000Z',
    });

    const err = await mediforce.namespaces
      .create({ handle: 'acme', displayName: 'Acme Co.' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('conflict');
  });
});

// PATCH /api/namespaces/:handle round-trip — owner edits metadata; client
// sees the entity-echo back; in-memory namespace repo reflects the write.
describe('Mediforce client ↔ route-adapter ↔ updateNamespace (in-process)', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest) => Promise<Response>;

  const ownerCaller: CallerIdentity = {
    kind: 'user',
    uid: 'uid-owner',
    namespaces: new Set(['acme']),
    namespaceRoles: new Map([['acme', 'owner']]),
    isSystemActor: false,
  };

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.namespaces.set('acme', {
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    auditRepo = new InMemoryAuditRepository();

    route = createRouteAdapter<typeof UpdateNamespaceInputSchema, UpdateNamespaceInput, unknown, { params: Promise<{ handle: string }> }>(
      UpdateNamespaceInputSchema,
      async (req, ctx) => {
        const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
        return { ...body, handle: (await ctx.params).handle };
      },
      updateNamespace,
      {
        resolveCaller: async () => ownerCaller,
        buildScope: (caller) => createTestScope({ caller, namespaceRepo, auditRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        const req = new NextRequest(absolute, init);
        // The path is `/api/namespaces/acme`; in production Next.js injects
        // ctx from the file-based router. In the loopback test we parse the
        // last path segment to feed the same ctx shape.
        const segments = new URL(absolute).pathname.split('/');
        const handle = segments[segments.length - 1] ?? '';
        return (route as unknown as (
          r: NextRequest,
          c: { params: Promise<{ handle: string }> },
        ) => Promise<Response>)(req, { params: Promise.resolve({ handle }) });
      },
    });
  });

  it('updates displayName/bio/icon and round-trips the entity-echo', async () => {
    const result = await mediforce.namespaces.update({
      handle: 'acme',
      displayName: 'Acme Inc.',
      bio: 'Widgets',
    });

    expect(result.namespace.displayName).toBe('Acme Inc.');
    expect(result.namespace.bio).toBe('Widgets');
    expect(namespaceRepo.namespaces.get('acme')?.displayName).toBe('Acme Inc.');
    expect(auditRepo.getAll().some((e) => e.action === 'namespace.updated')).toBe(true);
  });
});

// POST /api/namespaces/:handle/leave round-trip — owner blocked → 409
// precondition_failed; member succeeds.
describe('Mediforce client ↔ route-adapter ↔ leaveNamespace (in-process)', () => {
  let namespaceRepo: InMemoryNamespaceRepo;
  let auditRepo: InMemoryAuditRepository;
  let route: (req: NextRequest, ctx: { params: Promise<{ handle: string }> }) => Promise<Response>;

  function buildClient(caller: CallerIdentity): Mediforce {
    route = createRouteAdapter<typeof LeaveNamespaceInputSchema, LeaveNamespaceInput, unknown, { params: Promise<{ handle: string }> }>(
      LeaveNamespaceInputSchema,
      async (_req, ctx) => ({ handle: (await ctx.params).handle }),
      leaveNamespace,
      {
        resolveCaller: async () => caller,
        buildScope: (c) => createTestScope({ caller: c, namespaceRepo, auditRepo }),
      },
    );
    return new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        const req = new NextRequest(absolute, init);
        const segments = new URL(absolute).pathname.split('/');
        // path: /api/namespaces/<handle>/leave
        const handle = segments[segments.length - 2] ?? '';
        return route(req, { params: Promise.resolve({ handle }) });
      },
    });
  }

  beforeEach(() => {
    namespaceRepo = new InMemoryNamespaceRepo();
    namespaceRepo.namespaces.set('acme', {
      handle: 'acme',
      type: 'organization',
      displayName: 'Acme Co.',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    namespaceRepo.members.set('acme', [
      { uid: 'uid-owner', role: 'owner', joinedAt: '2026-01-01T00:00:00.000Z' },
      { uid: 'uid-member', role: 'member', joinedAt: '2026-01-02T00:00:00.000Z' },
    ]);
    namespaceRepo.userOrganizations.set('uid-owner', ['acme']);
    namespaceRepo.userOrganizations.set('uid-member', ['acme']);
    auditRepo = new InMemoryAuditRepository();
  });

  it('member leaves successfully and is removed from the workspace', async () => {
    const client = buildClient({
      kind: 'user',
      uid: 'uid-member',
      namespaces: new Set(['acme']),
      namespaceRoles: new Map([['acme', 'member']]),
      isSystemActor: false,
    });

    const result = await client.namespaces.leave({ handle: 'acme' });

    expect(result).toEqual({ handle: 'acme' });
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toEqual(['uid-owner']);
    expect(namespaceRepo.userOrganizations.get('uid-member')).toEqual([]);
  });

  it('owner cannot leave — 409 precondition_failed envelope', async () => {
    const client = buildClient({
      kind: 'user',
      uid: 'uid-owner',
      namespaces: new Set(['acme']),
      namespaceRoles: new Map([['acme', 'owner']]),
      isSystemActor: false,
    });

    const err = await client.namespaces.leave({ handle: 'acme' }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).code).toBe('precondition_failed');
    expect(namespaceRepo.members.get('acme')?.map((m) => m.uid)).toContain('uid-owner');
  });
});

// Fourth integration scenario: `runs.list` with the new `namespace` filter.
// Confirms wire field flows adapter → handler → scope.runs.list → in-memory
// repo, and that the storage layer narrows correctly while the caller's
// allowed-namespaces still bounds the result.
describe('Mediforce client ↔ route-adapter ↔ listRuns (in-process)', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest) => Promise<Response>;
  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-list-runs',
    namespaces: new Set(['team-alpha', 'team-beta']),
    namespaceRoles: new Map([
      ['team-alpha', 'member'],
      ['team-beta', 'member'],
    ]),
    isSystemActor: false,
  };

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    // Three runs across two workspaces + one in a workspace the caller is
    // not a member of. Vary createdAt so list ordering is deterministic.
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-alpha-1', namespace: 'team-alpha', createdAt: '2026-01-01T00:00:00.000Z' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-beta-1', namespace: 'team-beta', createdAt: '2026-01-02T00:00:00.000Z' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-alpha-2', namespace: 'team-alpha', createdAt: '2026-01-03T00:00:00.000Z' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-foreign', namespace: 'team-gamma', createdAt: '2026-01-04T00:00:00.000Z' }),
    );

    route = createRouteAdapter(
      ListRunsInputSchema,
      (req) => {
        const p = req.nextUrl.searchParams;
        return {
          workflow: p.get('workflow') ?? undefined,
          status: p.get('status') ?? undefined,
          namespace: p.get('namespace') ?? undefined,
          limit: p.get('limit') ?? undefined,
        };
      },
      listRuns,
      {
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, instanceRepo, humanTaskRepo }),
      },
    );

    mediforce = new Mediforce({ fetch: loopbackFetch(route) });
  });

  it('returns only the caller’s namespaces when no namespace filter set', async () => {
    const result = await mediforce.runs.list();
    const ids = result.runs.map((r) => r.id).sort();
    expect(ids).toEqual(['run-alpha-1', 'run-alpha-2', 'run-beta-1']);
  });

  it('narrows to a single workspace when `namespace` is set', async () => {
    const result = await mediforce.runs.list({ namespace: 'team-alpha' });
    const ids = result.runs.map((r) => r.id).sort();
    expect(ids).toEqual(['run-alpha-1', 'run-alpha-2']);
  });

  it('returns empty when the caller asks for a namespace they’re not a member of', async () => {
    const result = await mediforce.runs.list({ namespace: 'team-gamma' });
    expect(result.runs).toEqual([]);
  });
});

// Fifth integration scenario: `processes.listAuditEvents`. One round-trip
// proving the audit feed flows adapter → handler → scope and shape-checks
// against `ListAuditEventsOutputSchema`.
describe('Mediforce client ↔ route-adapter ↔ listAuditEvents (in-process)', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let auditRepo: InMemoryAuditRepository;
  let mediforce: Mediforce;
  let route: (
    req: NextRequest,
    ctx: { params: Promise<{ instanceId: string }> },
  ) => Promise<Response>;
  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-audit-test',
    namespaces: new Set(['team-alpha']),
    namespaceRoles: new Map([['team-alpha', 'member']]),
    isSystemActor: false,
  };

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-a', namespace: 'team-alpha' }),
    );
    await auditRepo.append({
      actorId: 'system',
      actorType: 'system',
      actorRole: 'engine',
      action: 'instance_created',
      description: 'Run started',
      timestamp: '2026-01-01T00:00:00.000Z',
      inputSnapshot: { workflow: 'demo' },
      outputSnapshot: {},
      basis: 'workflow definition',
      entityType: 'processInstance',
      entityId: 'run-a',
      processInstanceId: 'run-a',
    });
    await auditRepo.append({
      actorId: 'system',
      actorType: 'system',
      actorRole: 'engine',
      action: 'step_started',
      description: 'Step 1 begin',
      timestamp: '2026-01-01T00:00:01.000Z',
      inputSnapshot: {},
      outputSnapshot: {},
      basis: 'transition',
      entityType: 'step',
      entityId: 'step-1',
      processInstanceId: 'run-a',
      stepId: 'step-1',
    });

    route = createRouteAdapter<
      typeof ListAuditEventsInputSchema,
      { instanceId: string },
      { events: unknown },
      { params: Promise<{ instanceId: string }> }
    >(
      ListAuditEventsInputSchema,
      async (_req, ctx) => ({ instanceId: (await ctx.params).instanceId }),
      listAuditEvents,
      {
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, instanceRepo, humanTaskRepo, auditRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const instanceId = url.match(/\/api\/processes\/([^/]+)\/audit/)?.[1] ?? '';
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        return route(new NextRequest(absolute, init), {
          params: Promise.resolve({ instanceId: decodeURIComponent(instanceId) }),
        });
      },
    });
  });

  it('round-trips the audit feed for the caller’s run', async () => {
    const result = await mediforce.processes.listAuditEvents({ instanceId: 'run-a' });
    expect(result.events).toHaveLength(2);
    const actions = result.events.map((e) => e.action).sort();
    expect(actions).toEqual(['instance_created', 'step_started']);
  });

  it('returns 404 for a run in a workspace the caller does not belong to', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'run-foreign', namespace: 'team-beta' }),
    );
    const err = await mediforce.processes
      .listAuditEvents({ instanceId: 'run-foreign' })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(404);
  });
});

// Sixth integration scenario: caller-scope tasks axis — `mediforce.tasks.list({})`
// with no instanceId / role. Confirms the GitHub-like default flows through
// the contract → handler → wrapper → in-memory `listInNamespaces` path and
// returns the caller's full workspace-visible queue.
describe('Mediforce client ↔ route-adapter ↔ listTasks caller-scope (in-process)', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let mediforce: Mediforce;
  let route: (req: NextRequest) => Promise<Response>;
  const userCaller: CallerIdentity = {
    kind: 'user',
    uid: 'u-caller-scope',
    namespaces: new Set(['team-alpha']),
    namespaceRoles: new Map([['team-alpha', 'member']]),
    isSystemActor: false,
  };

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-a', namespace: 'team-alpha' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-b', namespace: 'team-beta' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't-alpha-1', processInstanceId: 'inst-a', assignedRole: 'reviewer', status: 'pending' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't-alpha-2', processInstanceId: 'inst-a', assignedRole: 'approver', status: 'claimed' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't-foreign', processInstanceId: 'inst-b', assignedRole: 'reviewer', status: 'pending' }),
    );

    route = createRouteAdapter(
      ListTasksInputSchema,
      (req) => {
        const p = req.nextUrl.searchParams;
        const statuses = p.getAll('status');
        return {
          instanceId: p.get('instanceId') ?? undefined,
          role: p.get('role') ?? undefined,
          stepId: p.get('stepId') ?? undefined,
          status: statuses.length > 0 ? statuses : undefined,
        };
      },
      listTasks,
      {
        resolveCaller: async () => userCaller,
        buildScope: (caller) => createTestScope({ caller, humanTaskRepo, instanceRepo }),
      },
    );

    mediforce = new Mediforce({ fetch: loopbackFetch(route) });
  });

  it('returns every task in the caller’s namespaces across roles when no axis is set', async () => {
    const result = await mediforce.tasks.list({});
    const ids = result.tasks.map((t) => t.id).sort();
    expect(ids).toEqual(['t-alpha-1', 't-alpha-2']);
  });

  it('combines caller-scope with status[] for the "my actionable queue" view', async () => {
    const result = await mediforce.tasks.list({ status: ['claimed'] });
    expect(result.tasks.map((t) => t.id)).toEqual(['t-alpha-2']);
  });
});
