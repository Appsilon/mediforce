import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessInstanceRepository,
  buildProcessInstance,
  buildStepExecution,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import { getStepSampleIo } from '../get-step-sample-io';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';

describe('getStepSampleIo handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
  });

  const NULL_RESULT = {
    input: null,
    output: null,
    instanceId: null,
    completedAt: null,
    status: null,
    error: null,
    fromDryRun: false,
  };

  it('returns nulls when the workflow has no runs', async () => {
    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );
    expect(result).toEqual(NULL_RESULT);
  });

  it('returns the latest completed execution input/output for the step', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-1',
      buildStepExecution({
        instanceId: 'inst-1',
        stepId: 's1',
        status: 'completed',
        input: { orderId: 'o-42' },
        output: { total: 100 },
        completedAt: '2026-01-01T00:05:00.000Z',
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result).toEqual({
      input: { orderId: 'o-42' },
      output: { total: 100 },
      instanceId: 'inst-1',
      completedAt: '2026-01-01T00:05:00.000Z',
      status: 'completed',
      error: null,
      fromDryRun: false,
    });
  });

  it('falls back to an older instance when the newest never reached the step', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-old',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-old',
      buildStepExecution({
        instanceId: 'inst-old',
        stepId: 's2',
        status: 'completed',
        output: { fromOld: true },
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-new',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        status: 'failed',
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's2' },
      scope,
    );

    expect(result.instanceId).toBe('inst-old');
    expect(result.output).toEqual({ fromOld: true });
  });

  it('surfaces a failed execution: real input, withheld output, the error message', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-1',
      buildStepExecution({
        instanceId: 'inst-1',
        stepId: 's1',
        status: 'failed',
        input: { orderId: 'o-42' },
        output: null,
        error: 'Script container failed (exit=1): KeyError: orderId',
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result).toEqual({
      input: { orderId: 'o-42' },
      output: null,
      instanceId: 'inst-1',
      completedAt: expect.any(String),
      status: 'failed',
      error: 'Script container failed (exit=1): KeyError: orderId',
      fromDryRun: false,
    });
  });

  it('withholds output from a dry run even though it completed (MockAgentPlugin output is fake)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        dryRun: true,
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-1',
      buildStepExecution({
        instanceId: 'inst-1',
        stepId: 's1',
        status: 'completed',
        input: { orderId: 'o-42' },
        output: { mock: true, summary: 'Mock output for step s1' },
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result.input).toEqual({ orderId: 'o-42' });
    expect(result.output).toBeNull();
    expect(result.fromDryRun).toBe(true);
  });

  it('prefers an older real completed run over a more recent dry run (regression: dry run was shadowing real output)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-real',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        dryRun: false,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-real',
      buildStepExecution({
        instanceId: 'inst-real',
        stepId: 's1',
        status: 'completed',
        input: { projectName: 'ooo' },
        output: { slug: 'ooo', projectName: 'ooo' },
      }),
    );
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-dry',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        dryRun: true,
        createdAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-dry',
      buildStepExecution({
        instanceId: 'inst-dry',
        stepId: 's1',
        status: 'completed',
        input: { projectName: 'test' },
        output: { mock: true, summary: 'Mock output for step s1' },
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result.instanceId).toBe('inst-real');
    expect(result.output).toEqual({ slug: 'ooo', projectName: 'ooo' });
    expect(result.fromDryRun).toBe(false);
  });

  it('falls back to the newest dry run when no real completed run exists in the scan window', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-dry',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
        dryRun: true,
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-dry',
      buildStepExecution({
        instanceId: 'inst-dry',
        stepId: 's1',
        status: 'completed',
        input: { projectName: 'test' },
        output: { mock: true, summary: 'Mock output for step s1' },
      }),
    );

    const scope = createTestScope({ instanceRepo });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result.instanceId).toBe('inst-dry');
    expect(result.input).toEqual({ projectName: 'test' });
    expect(result.output).toBeNull();
    expect(result.fromDryRun).toBe(true);
  });

  it('returns nulls for a cross-namespace caller (no enumeration leak)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-1',
        definitionName: 'flow-x',
        namespace: 'team-alpha',
      }),
    );
    await instanceRepo.addStepExecution(
      'inst-1',
      buildStepExecution({ instanceId: 'inst-1', stepId: 's1', status: 'completed' }),
    );

    const scope = createTestScope({
      instanceRepo,
      caller: userCaller('u-2', ['team-beta']),
    });
    const result = await getStepSampleIo(
      { namespace: 'team-alpha', name: 'flow-x', stepId: 's1' },
      scope,
    );

    expect(result).toEqual(NULL_RESULT);
  });
});
