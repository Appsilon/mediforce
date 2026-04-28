import { beforeEach, describe, expect, it } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  InMemoryCoworkSessionRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../../engine/workflow-engine.js';
import { WebhookRouter } from '../webhook-router.js';

const definition: WorkflowDefinition = {
  name: 'execution-summaries-api',
  version: 1,
  namespace: 'examples',
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
  triggers: [
    {
      type: 'webhook',
      name: 'main',
      config: { method: 'POST', path: '/execution-summaries' },
    },
  ],
};

let processRepo: InMemoryProcessRepository;
let engine: WorkflowEngine;
let router: WebhookRouter;

beforeEach(async () => {
  processRepo = new InMemoryProcessRepository();
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
  router = new WebhookRouter(engine, processRepo);
  await processRepo.saveWorkflowDefinition(definition);
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
    router = new WebhookRouter(engine, processRepo);

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
});
