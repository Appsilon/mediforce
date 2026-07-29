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
          body: '${triggerPayload.summary}',
        },
      },
    },
  ],
  transitions: [],
  // ADR-0012: the body's top-level keys ARE these fields. `summary` is `object`
  // because callers post opaque JSON — the escape hatch for an un-enumerable body.
  triggerInput: [
    { name: 'summary', type: 'object', required: true },
    { name: 'label', type: 'string', required: false },
  ],
};

/** A body satisfying `definition`'s contract. */
const validBody = { summary: { hello: 'world' } };

/** An enabled `webhook` row in the unified triggers table. */
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
      body: validBody,
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
      body: validBody,
      headers: { 'x-trace': 'abc' },
    });
    expect(result.status).toBe(202);
    if (result.status !== 202) return;

    const instance = await instanceRepo.getById(result.runId);
    expect(instance).not.toBeNull();
    expect(instance?.triggerType).toBe('webhook');
    // The payload is the *validated contract*, not the HTTP envelope — a step
    // reading `${triggerPayload.summary}` gets the same thing a manual or cron
    // firing would hand it (ADR-0012).
    expect(instance?.triggerPayload).toEqual(validBody);
    // The envelope moved to triggerContext, and `body` is not on it: a step can
    // no longer reach the raw request through either namespace.
    expect(instance?.triggerContext).toEqual({
      headers: { 'x-trace': 'abc' },
      query: {},
      method: 'POST',
      path: '/execution-summaries',
    });
    expect(instance?.triggerContext).not.toHaveProperty('body');
    expect(instance?.status).toBe('running');
    expect(instance?.currentStepId).toBe('echo');
  });

  it('fills in a declared default for a field the body omits', async () => {
    // The `default` belongs to the contract, so a sender who leaves the field
    // out lands on the same value a manual firing would (ADR-0012).
    const withDefault: WorkflowDefinition = {
      ...definition,
      name: 'defaulted-summaries',
      triggerInput: [
        { name: 'summary', type: 'object', required: true },
        { name: 'label', type: 'string', required: false, default: 'nightly' },
      ],
    };
    await processRepo.saveWorkflowDefinition(withDefault);
    await triggerRepo.create(webhookRow({ workflowName: 'defaulted-summaries' }));

    const instanceRepo = new InMemoryProcessInstanceRepository();
    router = new WebhookRouter(
      new WorkflowEngine(
        processRepo,
        instanceRepo,
        new InMemoryAuditRepository(),
        undefined,
        undefined,
        undefined,
        new InMemoryHumanTaskRepository(),
        new InMemoryCoworkSessionRepository(),
      ),
      processRepo,
      triggerRepo,
    );

    const result = await router.route({
      namespace: 'examples',
      workflowName: 'defaulted-summaries',
      suffix: '/execution-summaries',
      method: 'POST',
      body: validBody,
    });
    expect(result.status).toBe(202);
    if (result.status !== 202) return;

    const instance = await instanceRepo.getById(result.runId);
    expect(instance?.triggerPayload).toEqual({ ...validBody, label: 'nightly' });
  });

  it('rejects a body carrying a field the contract does not declare', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { ...validBody, sneaky: 1 },
    });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.details?.map((e) => e.field)).toEqual(['sneaky']);
  });

  it('rejects a body missing a required field', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { label: 'nightly' },
    });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.details?.[0]?.field).toBe('summary');
  });

  it('rejects a value of the wrong type', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      // `summary` is `object`; a bare array has no keys to walk.
      body: { summary: [1, 2] },
    });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.details?.[0]?.message).toMatch(/JSON object/);
  });

  it('rejects a body that is not a JSON object at all', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: 'plain text',
    });
    expect(result.status).toBe(400);
  });

  it('names the expected fields in the rejection', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: '/execution-summaries',
      method: 'POST',
      body: {},
    });
    expect(result.status).toBe(400);
    if (result.status !== 400) return;
    expect(result.error).toContain('summary: object');
    expect(result.error).toContain('label: string');
  });

  it('rejects a non-empty body when the workflow declares no triggerInput', async () => {
    // The contract is *total*: an empty triggerInput means "takes no input",
    // not "anything goes" (ADR-0012 D2).
    const contractFree: WorkflowDefinition = {
      ...definition,
      name: 'no-input',
      triggerInput: [],
      steps: [{ id: 'echo', name: 'echo', type: 'terminal', executor: 'human' }],
    };
    await processRepo.saveWorkflowDefinition(contractFree);
    await triggerRepo.create(webhookRow({ workflowName: 'no-input' }));

    const rejected = await router.route({
      namespace: 'examples',
      workflowName: 'no-input',
      suffix: '/execution-summaries',
      method: 'POST',
      body: { anything: 1 },
    });
    expect(rejected.status).toBe(400);

    const accepted = await router.route({
      namespace: 'examples',
      workflowName: 'no-input',
      suffix: '/execution-summaries',
      method: 'POST',
      body: null,
    });
    expect(accepted.status).toBe(202);
  });

  it('normalizes suffix without leading slash', async () => {
    const result = await router.route({
      namespace: 'examples',
      workflowName: 'execution-summaries-api',
      suffix: 'execution-summaries',
      method: 'POST',
      body: validBody,
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

  it('resolves against the detached triggers table', async () => {
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
      body: validBody,
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
      body: validBody,
    });
    expect(result.status).toBe(202);
  });
});
