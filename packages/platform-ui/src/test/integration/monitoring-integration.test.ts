import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  InMemoryHumanTaskRepository,
  InMemoryProcessInstanceRepository,
  buildHumanTask,
  buildProcessInstance,
} from '@mediforce/platform-core/testing';
import { getMonitoringSummary } from '@mediforce/platform-api/handlers';
import { MonitoringSummaryInputSchema } from '@mediforce/platform-api/contract';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { Mediforce } from '@mediforce/platform-api/client';
import { createRouteAdapter } from '../../lib/route-adapter';
import { createTestScope, userCaller } from '@mediforce/platform-api/testing';

const apiKeyCaller: CallerIdentity = { kind: 'apiKey', isSystemActor: true };

interface RouteWithHandleCtx {
  (req: NextRequest, ctx: { params: Promise<{ handle: string }> }): Promise<Response>;
}

/**
 * Loopback fetch for the handle-scoped monitoring summary route. The route
 * adapter expects `ctx.params` to resolve to `{ handle }`; this loopback
 * extracts the handle from the URL so the SDK call exercises the real
 * adapter stack.
 */
function loopbackFetch(route: RouteWithHandleCtx): typeof fetch {
  return async (input, init) => {
    const url = typeof input === 'string' ? input : input.toString();
    const absolute = url.startsWith('http') ? url : `http://localhost${url}`;
    const req = new NextRequest(absolute, init);
    const pathname = new URL(absolute).pathname;
    const match = pathname.match(/^\/api\/namespaces\/([^/]+)\/monitoring\/summary$/);
    if (match === null) {
      throw new Error(`unexpected URL in monitoring loopback: ${pathname}`);
    }
    const handle = decodeURIComponent(match[1]!);
    return route(req, { params: Promise.resolve({ handle }) });
  };
}

describe('Mediforce client ↔ route-adapter ↔ monitoring summary handler (in-process)', () => {
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(async () => {
    instanceRepo = new InMemoryProcessInstanceRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-1', namespace: 'team-alpha', status: 'running' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-2', namespace: 'team-alpha', status: 'paused' }),
    );
    await instanceRepo.create(
      buildProcessInstance({ id: 'inst-3', namespace: 'team-beta', status: 'running' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't1', processInstanceId: 'inst-1', assignedRole: 'reviewer', status: 'pending' }),
    );
    await humanTaskRepo.create(
      buildHumanTask({ id: 't2', processInstanceId: 'inst-2', assignedRole: 'reviewer', status: 'claimed' }),
    );
  });

  function buildClient(caller: CallerIdentity): Mediforce {
    const route = createRouteAdapter(
      MonitoringSummaryInputSchema,
      async (_req, ctx: { params: Promise<{ handle: string }> }) => ({
        handle: (await ctx.params).handle,
      }),
      getMonitoringSummary,
      {
        resolveCaller: async () => caller,
        buildScope: (c) => createTestScope({ caller: c, humanTaskRepo, instanceRepo }),
      },
    );
    return new Mediforce({ fetch: loopbackFetch(route as RouteWithHandleCtx) });
  }

  it('round-trips a summary query through the adapter, handler and repos', async () => {
    const mediforce = buildClient(apiKeyCaller);
    const { summary } = await mediforce.monitoring.summary({ handle: 'team-alpha' });

    expect(summary.runs.running).toBe(1);
    expect(summary.runs.paused).toBe(1);
    expect(summary.tasks.pending).toBe(1);
    expect(summary.tasks.claimed).toBe(1);
    expect(summary.roleTaskCounts).toEqual({ reviewer: { pending: 1, claimed: 1 } });
  });

  it('returns a 403 envelope when a user caller hits a workspace they do not belong to', async () => {
    const mediforce = buildClient(userCaller('u-1', ['team-alpha']));
    await expect(mediforce.monitoring.summary({ handle: 'team-beta' })).rejects.toMatchObject({
      status: 403,
      code: 'forbidden',
    });
  });
});
