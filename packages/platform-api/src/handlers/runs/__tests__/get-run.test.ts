import { describe, expect, it, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  buildProcessInstance,
  buildStepExecution,
  buildWorkflowDefinition,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getRun } from '../get-run.js';
import { ApiError } from '../../../errors.js';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope.js';

describe('getRun handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let processRepo: InMemoryProcessRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    processRepo = new InMemoryProcessRepository();
  });

  it('returns the run with finalOutput from the last completed step (apiKey)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'r1',
        namespace: 'alpha',
        definitionName: 'wf',
        definitionVersion: '1',
        status: 'completed',
      }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e1', instanceId: 'r1', stepId: 's1', output: { early: true } }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e2', instanceId: 'r1', stepId: 's2', output: { final: 42 } }),
    );
    await processRepo.saveWorkflowDefinition(
      buildWorkflowDefinition({ namespace: 'alpha', name: 'wf', version: 1 }),
    );

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getRun({ runId: 'r1' }, scope);

    expect(result.runId).toBe('r1');
    expect(result.status).toBe('completed');
    expect(result.finalOutput).toEqual({ final: 42 });
    expect(result.definitionName).toBe('wf');
    expect(result.definitionNamespace).toBe('alpha');
  });

  it('returns null finalOutput while the run is still active', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', status: 'running' }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e1', instanceId: 'r1', output: { done: true } }),
    );

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getRun({ runId: 'r1' }, scope);

    expect(result.finalOutput).toBeNull();
  });

  it('skips later steps without output and picks the most recent completed one with output', async () => {
    await instanceRepo.create(
      buildProcessInstance({ id: 'r1', namespace: 'alpha', status: 'failed' }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e1', instanceId: 'r1', stepId: 's1', status: 'completed', output: { picked: true } }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e2', instanceId: 'r1', stepId: 's2', status: 'failed', output: null }),
    );
    await instanceRepo.addStepExecution(
      'r1',
      buildStepExecution({ id: 'e3', instanceId: 'r1', stepId: 's3', status: 'completed', output: null }),
    );

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getRun({ runId: 'r1' }, scope);

    expect(result.finalOutput).toEqual({ picked: true });
  });

  it('returns null definitionNamespace when the workflow definition is gone', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'r1',
        namespace: 'alpha',
        definitionName: 'wf-missing',
        definitionVersion: '1',
        status: 'completed',
      }),
    );

    const scope = createTestScope({ instanceRepo, processRepo });
    const result = await getRun({ runId: 'r1' }, scope);

    expect(result.definitionNamespace).toBeNull();
  });

  it('returns the run for a user caller in the namespace', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha' }));

    const scope = createTestScope({
      instanceRepo,
      processRepo,
      caller: userCaller('u-1', ['alpha']),
    });
    const result = await getRun({ runId: 'r1' }, scope);

    expect(result.runId).toBe('r1');
  });

  it('throws ApiError(not_found) for a foreign-workspace runId (anti-enumeration)', async () => {
    await instanceRepo.create(buildProcessInstance({ id: 'r1', namespace: 'alpha' }));

    const scope = createTestScope({
      instanceRepo,
      processRepo,
      caller: userCaller('u-2', ['beta']),
    });

    await expect(getRun({ runId: 'r1' }, scope)).rejects.toBeInstanceOf(ApiError);
  });

  it('throws ApiError(not_found) for a truly missing runId', async () => {
    const scope = createTestScope({ instanceRepo, processRepo });
    await expect(getRun({ runId: 'missing' }, scope)).rejects.toBeInstanceOf(ApiError);
  });
});
