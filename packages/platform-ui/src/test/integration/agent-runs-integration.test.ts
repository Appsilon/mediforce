import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  InMemoryAgentRunRepository,
  InMemoryProcessInstanceRepository,
  buildAgentRun,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { listAgentRuns, getByIdAdapter } from '@mediforce/platform-api/handlers';
import {
  GetAgentRunInputSchema,
  ListAgentRunsInputSchema,
} from '@mediforce/platform-api/contract';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { Mediforce } from '@mediforce/platform-api/client';
import { createRouteAdapter } from '../../lib/route-adapter';
import { createTestScope, userCaller } from '@mediforce/platform-api/testing';

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

interface RouteWithCtx {
  (req: NextRequest, ctx: { params: Promise<{ agentRunId: string }> }): Promise<Response>;
}

/**
 * Loopback fetch: invokes the right route based on URL path. Two routes are
 * registered — the agent-runs list and the agent-runs detail — so the
 * Mediforce client's `list` and `get` exercise the actual adapter stack.
 */
function loopbackFetch(
  listRoute: (req: NextRequest) => Promise<Response>,
  detailRoute: RouteWithCtx,
): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
    const req = new NextRequest(absolute, init);
    const pathname = new URL(absolute).pathname;
    const match = pathname.match(/^\/api\/agent-runs\/(.+)$/);
    if (match !== null) {
      const agentRunId = decodeURIComponent(match[1]!);
      return detailRoute(req, { params: Promise.resolve({ agentRunId }) });
    }
    return listRoute(req);
  };
}

describe('Mediforce client ↔ route-adapter ↔ agentRuns handlers (in-process)', () => {
  let agentRunRepo: InMemoryAgentRunRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let mediforce: Mediforce;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha' }));
    await agentRunRepo.create(
      buildAgentRun({ id: 'ar-1', processInstanceId: 'inst-1', startedAt: '2026-05-28T12:00:00.000Z' }),
    );

    const listRoute = createRouteAdapter(
      ListAgentRunsInputSchema,
      (req) => {
        const p = req.nextUrl.searchParams;
        return {
          namespace: p.get('namespace') ?? undefined,
          runId: p.get('runId') ?? undefined,
          stepId: p.get('stepId') ?? undefined,
          limit: p.get('limit') ?? undefined,
          cursor: p.get('cursor') ?? undefined,
        };
      },
      listAgentRuns,
      {
        resolveCaller: async () => apiKeyCaller,
        buildScope: (caller) => createTestScope({ caller, agentRunRepo, instanceRepo }),
      },
    );

    const detailRoute = createRouteAdapter(
      GetAgentRunInputSchema,
      async (_req, ctx: { params: Promise<{ agentRunId: string }> }) => ({
        agentRunId: (await ctx.params).agentRunId,
      }),
      getByIdAdapter(
        (input, scope) => scope.agentRuns.getById(input.agentRunId),
        'Agent run not found',
        'run',
      ),
      {
        resolveCaller: async () => apiKeyCaller,
        buildScope: (caller) => createTestScope({ caller, agentRunRepo, instanceRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: loopbackFetch(listRoute, detailRoute as RouteWithCtx),
    });
  });

  it('round-trips a list query through the adapter, handler and repo', async () => {
    const result = await mediforce.agentRuns.list({ namespace: 'team-alpha' });
    expect(result.runs.map((r) => r.id)).toEqual(['ar-1']);
  });

  it('round-trips a single get through the adapter and getByIdAdapter', async () => {
    const result = await mediforce.agentRuns.get({ agentRunId: 'ar-1' });
    expect(result.run.id).toBe('ar-1');
  });

  it('surfaces a 404 when the agent run is missing', async () => {
    await expect(mediforce.agentRuns.get({ agentRunId: 'nope' })).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('Mediforce client ↔ route-adapter ↔ agentRuns handlers (user caller cross-workspace)', () => {
  let agentRunRepo: InMemoryAgentRunRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let mediforce: Mediforce;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    agentRunRepo = new InMemoryAgentRunRepository(instanceRepo);
    await instanceRepo.create(buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha' }));
    await agentRunRepo.create(buildAgentRun({ id: 'ar-1', processInstanceId: 'inst-1' }));

    const caller = userCaller('u-1', ['team-alpha']);
    const listRoute = createRouteAdapter(
      ListAgentRunsInputSchema,
      (req) => {
        const p = req.nextUrl.searchParams;
        return {
          namespace: p.get('namespace') ?? undefined,
          runId: p.get('runId') ?? undefined,
          stepId: p.get('stepId') ?? undefined,
          limit: p.get('limit') ?? undefined,
          cursor: p.get('cursor') ?? undefined,
        };
      },
      listAgentRuns,
      {
        resolveCaller: async () => caller,
        buildScope: (c) => createTestScope({ caller: c, agentRunRepo, instanceRepo }),
      },
    );

    mediforce = new Mediforce({
      fetch: async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
        return listRoute(new NextRequest(absolute, init));
      },
    });
  });

  // PR2 keeps parity with the pre-PR2 Firestore subscription, which had
  // no per-row workspace gating on agent-runs. Real gating + filter
  // pushdown returns once the storage migrates to Postgres with a
  // denormalised `namespace` column (#588).
  it('user caller still sees their own workspace runs without an explicit filter', async () => {
    const { runs } = await mediforce.agentRuns.list({});
    expect(runs.map((r) => r.id)).toEqual(['ar-1']);
  });

  it('explicit cross-workspace ?namespace= currently no-ops to the full list (#588)', async () => {
    const { runs } = await mediforce.agentRuns.list({ namespace: 'team-beta' });
    expect(runs.map((r) => r.id)).toEqual(['ar-1']);
  });
});
