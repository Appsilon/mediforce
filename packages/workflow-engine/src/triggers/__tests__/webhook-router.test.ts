import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryCoworkSessionRepository,
  InMemoryTriggerRepository,
} from '@mediforce/platform-core';
import type { TriggerResource, WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../../engine/workflow-engine';
import { WebhookRouter } from '../webhook-router';

const definition: WorkflowDefinition = {
  name: 'execution-summaries-api',
  version: 1,
  namespace: 'examples',
  visibility: 'private',
  steps: [
    {
      id: 'echo',
      name: 'echo',
      type: 'terminal',
      executor: 'action',
      action: {
        kind: 'http',
        config: {
          method: 'POST',
          url: 'http://localhost:9099/anything',
          body: '${triggerPayload.body}',
        },
      },
    },
  ],
  transitions: [],
  // The definition's advisory triggers are no longer what the router reads —
  // resolution is against the detached `triggers` table (Issue #931). Kept
  // here only because the schema requires at least one declared trigger.
  triggers: [
    {
      type: 'webhook',
      name: 'main',
      config: { method: 'POST', path: '/execution-summaries' },
    },
  ],
};

/** An enabled `webhook` row in the unified triggers table — what the router
 *  now resolves against instead of `definition.triggers`. */
function webhookRow(
  overrides: Partial<Extract<TriggerResource, { type: 'webhook' }>> = {},
): TriggerResource {
  const now = new Date().toISOString();
  return {
    type: 'webhook',
    namespace: 'examples',
    workflowName: 'execution-summaries-api',
    name: 'main',
    enabled: true,
    config: { method: 'POST', path: '/execution-summaries' },
    lastTriggeredAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

let processRepo: InMemoryProcessRepository;
let triggerRepo: InMemoryTriggerRepository;
let engine: WorkflowEngine;
let router: WebhookRouter;

beforeEach(async () => {
  processRepo = new InMemoryProcessRepository();
  triggerRepo = new InMemoryTriggerRepository();
  const instanceRepo = new InMemoryProcessInstanceRepository();
  const auditRepo = new InMemoryAuditRepository();
  const humanTaskRepo = new InMemoryHumanTaskRepository();
  const coworkSessionRepo = new InMemoryCoworkSessionRepository();
  engine = new WorkflowEngine(
    processRepo,
    instanceRepo,
    auditRepo,
    undefined,
    undefined,
    undefined,
    humanTaskRepo,
    coworkSessionRepo,
  );
  router = new WebhookRouter(engine, processRepo, triggerRepo);
  await processRepo.saveWorkflowDefinition(definition);
  await triggerRepo.create(webhookRow());
});

describe('WebhookRouter', () => {
  it('routes a matching POST to a created+started instance and returns 202', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { hello: 'world' },
    });

    expect(result.status).toBe(202);
    if (result.status !== 202) return;
    expect(result.runId.length).toBeGreaterThan(0);
    expect(result.statusUrl).toBe(`/api/runs/${result.runId}`);
  });

  it('persists triggerPayload on the created instance', async () => {
    const instanceRepo = new InMemoryProcessInstanceRepository();
    engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      new InMemoryAuditRepository(),
      undefined,
      undefined,
      undefined,
      new InMemoryHumanTaskRepository(),
      new InMemoryCoworkSessionRepository(),
    );
    router = new WebhookRouter(engine, processRepo, triggerRepo);

    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { hello: 'world' },
      headers: { 'x-trace': 'abc' },
    });
    expect(result.status).toBe(202);
    if (result.status !== 202) return;

    const instance = await instanceRepo.getById(result.runId);
    expect(instance).not.toBeNull();
    expect(instance?.triggerType).toBe('webhook');
    expect(instance?.triggerPayload).toEqual({
      body: { hello: 'world' },
      headers: { 'x-trace': 'abc' },
      query: {},
      method: 'POST',
      path: '/execution-summaries',
    });
    expect(instance?.status).toBe('running');
    expect(instance?.currentStepId).toBe('echo');
  });

  it('normalizes suffix without leading slash', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: 'execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(202);
  });

  it('returns 404 when workflow does not exist', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'unknown',
      suffix: '/execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(404);
  });

  it('returns 404 when workflow exists in a different namespace', async () => {
    const result = await router.route({
      namespace: 'someone-else',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(404);
  });

  it('returns 404 when no webhook trigger matches the suffix', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/wrong-path',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(404);
  });

  it('returns 405 when method does not match the trigger', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'GET',
      body: {},
    });
    expect(result.status).toBe(405);
  });

  it('returns 404 when the matching webhook row is stopped (disabled)', async () => {
    // Stop the webhook: the row exists but is disabled, so its endpoint no
    // longer resolves. This is the table-backed lifecycle #931 buys — no new
    // definition version needed to take a webhook offline.
    await triggerRepo.update('examples', 'execution-summaries-api', 'main', {
      enabled: false,
      updatedAt: new Date().toISOString(),
    });

    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(404);
  });

  it('resolves against the triggers table, not the definition triggers', async () => {
    // Attach a second webhook at a NEW path that the definition never
    // declared. The router must resolve it purely from the table.
    await triggerRepo.create(
      webhookRow({ name: 'reports', config: { method: 'POST', path: '/reports' } }),
    );

    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/reports',
      method: 'POST',
      body: { hello: 'world' },
    });
    expect(result.status).toBe(202);
  });

  it('returns 400 when namespace is empty', async () => {
    const result = await router.route({
      namespace: '',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(400);
  });

  it('resolves the namespace-local version when two tenants share a workflow name', async () => {
    // Underlying storage is keyed by (name, version) globally — without
    // namespace-scoped lookup the tenant with the highest version would
    // shadow the other. Register a v5 owned by `tenant-b` and confirm a
    // request to `tenant-a` still picks up tenant-a's v3 instead of 404'ing.
    const tenantBV5: WorkflowDefinition = {
      ...definition,
      namespace: 'tenant-b',
      version: 5,
    };
    const tenantAV3: WorkflowDefinition = {
      ...definition,
      namespace: 'tenant-a',
      version: 3,
    };
    await processRepo.saveWorkflowDefinition(tenantBV5);
    await processRepo.saveWorkflowDefinition(tenantAV3);
    await triggerRepo.create(webhookRow({ namespace: 'tenant-a' }));
    await triggerRepo.create(webhookRow({ namespace: 'tenant-b' }));

    const result = await router.route({
      namespace: 'tenant-a',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { hello: 'world' },
    });
    expect(result.status).toBe(202);
  });
});
