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
  buildHumanTask,
} from '@mediforce/platform-core/testing';
import { listTasks } from '@mediforce/platform-api/handlers';
import { ListTasksInputSchema } from '@mediforce/platform-api/contract';
import type { CallerIdentity } from '@mediforce/platform-api/auth';
import { Mediforce } from '@mediforce/platform-api/client';
import { createRouteAdapter } from '../../lib/route-adapter';
import { createTestScope } from '@mediforce/platform-api/testing';

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
    expect(body.error).toMatch(/exactly one of/i);
  });
});
