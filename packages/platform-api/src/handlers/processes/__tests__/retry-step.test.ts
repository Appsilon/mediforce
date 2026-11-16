import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryProcessInstanceRepository,
  InMemoryProcessRepository,
  InMemoryAgentRunRepository,
  InMemoryAgentDefinitionRepository,
  buildProcessInstance,
  buildStepExecution,
  buildWorkflowDefinition,
  buildAgentRun,
  resetFactorySequence,
} from '@mediforce/platform-core/testing';
import type { ProcessInstance } from '@mediforce/platform-core';
import { retryStep } from '../retry-step';
import { NotFoundError, PreconditionFailedError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { noopRunKicker } from '../../../runtime/run-kicker';

/**
 * Handler-level tests for `retryStep`. The engine is stubbed; engine-internal
 * mechanics (variable preservation, `step.retried` emission) belong to
 * `workflow-engine`'s own `retry-step.test.ts`. This file covers the
 * handler-resident bridge: audit emission at the instance level, run kick,
 * error mapping, and workspace gating.
 */

interface EngineStubCall {
  readonly instanceId: string;
  readonly stepId: string;
  readonly actor: { readonly id: string; readonly role: string };
}

function makeEngineStub(opts: {
  readonly result?: ProcessInstance;
  readonly throws?: Error;
  readonly onCall?: () => Promise<void>;
}) {
  const calls: EngineStubCall[] = [];
  return {
    calls,
    async retryStep(
      instanceId: string,
      stepId: string,
      actor: { readonly id: string; readonly role: string },
    ): Promise<ProcessInstance> {
      calls.push({ instanceId, stepId, actor });
      if (opts.onCall) await opts.onCall();
      if (opts.throws) throw opts.throws;
      if (!opts.result) throw new Error('engine stub missing result');
      return opts.result;
    },
  };
}

describe('retryStep handler', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(async () => {
    resetFactorySequence();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-a',
        namespace: 'team-alpha',
        status: 'failed',
        currentStepId: 'deploy',
        definitionVersion: '4',
      }),
    );
  });

  it('returns the engine-updated run, emits instance.retried, kicks the runner', async () => {
    const instanceAfter: ProcessInstance = {
      ...(await instanceRepo.getById('inst-a'))!,
      status: 'running',
      error: null,
    };
    const engineStub = makeEngineStub({ result: instanceAfter });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const result = await retryStep(
      { runId: 'inst-a', stepId: 'deploy' },
      scope,
    );

    expect(result.run.id).toBe('inst-a');
    expect(result.run.status).toBe('running');

    expect(engineStub.calls).toEqual([
      { instanceId: 'inst-a', stepId: 'deploy', actor: { id: 'u-1', role: 'operator' } },
    ]);

    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.action).toBe('instance.retried');
    expect(event.actorId).toBe('u-1');
    expect(event.actorType).toBe('user');
    expect(event.entityType).toBe('processInstance');
    expect(event.entityId).toBe('inst-a');
    expect(event.processInstanceId).toBe('inst-a');
    expect(event.processDefinitionVersion).toBe('4');
    expect(event.inputSnapshot).toMatchObject({
      instanceId: 'inst-a',
      stepId: 'deploy',
      previousExecutionId: null,
      previousError: null,
    });
    // Exact match: the retried execution's id is unknowable at audit time
    // (created later by the runner), so no execution id may appear here.
    expect(event.outputSnapshot).toEqual({
      resetTo: 'running',
      currentStepId: 'deploy',
    });

    expect(kicker.kicks).toEqual([
      { instanceId: 'inst-a', triggeredBy: 'u-1' },
    ]);
  });

  it('snapshots the seeded failed execution as previous, never as new', async () => {
    const failedExecution = buildStepExecution({
      instanceId: 'inst-a',
      stepId: 'deploy',
      status: 'failed',
      output: null,
      error: 'deploy target unreachable',
    });
    await instanceRepo.addStepExecution('inst-a', failedExecution);

    const instanceAfter: ProcessInstance = {
      ...(await instanceRepo.getById('inst-a'))!,
      status: 'running',
      error: null,
    };
    const engineStub = makeEngineStub({ result: instanceAfter });
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: noopRunKicker(),
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await retryStep({ runId: 'inst-a', stepId: 'deploy' }, scope);

    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.inputSnapshot).toEqual({
      instanceId: 'inst-a',
      stepId: 'deploy',
      previousExecutionId: failedExecution.id,
      previousError: 'deploy target unreachable',
    });
    expect(event.outputSnapshot).toEqual({
      resetTo: 'running',
      currentStepId: 'deploy',
    });
  });

  it('snapshots the pre-retry failure even when a worker claims the run mid-retry', async () => {
    const failedExecution = buildStepExecution({
      instanceId: 'inst-a',
      stepId: 'deploy',
      status: 'failed',
      output: null,
      error: 'deploy target unreachable',
    });
    await instanceRepo.addStepExecution('inst-a', failedExecution);

    const instanceAfter: ProcessInstance = {
      ...(await instanceRepo.getById('inst-a'))!,
      status: 'running',
      error: null,
    };
    // The engine flips the instance to `running`, so a worker may claim the run
    // and append the retry's own execution before the handler audits.
    const engineStub = makeEngineStub({
      result: instanceAfter,
      onCall: async () => {
        await instanceRepo.addStepExecution(
          'inst-a',
          buildStepExecution({
            instanceId: 'inst-a',
            stepId: 'deploy',
            status: 'running',
            output: null,
            error: null,
            startedAt: '2030-01-01T00:00:00.000Z',
          }),
        );
      },
    });
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: noopRunKicker(),
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await retryStep({ runId: 'inst-a', stepId: 'deploy' }, scope);

    const event = (await auditRepo.getByProcess('inst-a'))[0]!;
    expect(event.inputSnapshot).toEqual({
      instanceId: 'inst-a',
      stepId: 'deploy',
      previousExecutionId: failedExecution.id,
      previousError: 'deploy target unreachable',
    });
  });

  it('maps engine InvalidTransitionError to PreconditionFailedError (409)', async () => {
    const { InvalidTransitionError } = await import('@mediforce/workflow-engine');
    const engineStub = makeEngineStub({
      throws: new InvalidTransitionError('completed', 'retryStep'),
    });
    const kicker = noopRunKicker();
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      runKicker: kicker,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    const err = await retryStep(
      { runId: 'inst-a', stepId: 'deploy' },
      scope,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(PreconditionFailedError);
    expect((err as PreconditionFailedError).code).toBe('precondition_failed');
    // No audit / no kick on failure.
    const events = await auditRepo.getByProcess('inst-a');
    expect(events).toHaveLength(0);
    expect(kicker.kicks).toHaveLength(0);
  });

  it('throws NotFoundError for a foreign-workspace instance (anti-enum)', async () => {
    await instanceRepo.create(
      buildProcessInstance({
        id: 'inst-foreign',
        namespace: 'team-beta',
        status: 'failed',
      }),
    );
    const engineStub = makeEngineStub({
      result: (await instanceRepo.getById('inst-foreign'))!,
    });
    const scope = createTestScope({
      instanceRepo,
      auditRepo,
      caller: userCaller('u-1', ['team-alpha']),
    });
    Object.assign(scope.system, { engine: engineStub });

    await expect(
      retryStep({ runId: 'inst-foreign', stepId: 'deploy' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);

    // Workspace gate trips before engine is invoked.
    expect(engineStub.calls).toHaveLength(0);
  });

  describe('agent drift guard (epic #1673 B1 + B2)', () => {
    async function buildDriftScope(opts: { ranVersion: number; currentVersion: number; pinnedVersion?: number }) {
      const driftInstanceRepo = new InMemoryProcessInstanceRepository();
      const driftAuditRepo = new InMemoryAuditRepository(driftInstanceRepo);
      const agentRunRepo = new InMemoryAgentRunRepository(driftInstanceRepo);
      const agentDefinitionRepo = new InMemoryAgentDefinitionRepository();
      const processRepo = new InMemoryProcessRepository();

      await driftInstanceRepo.create(
        buildProcessInstance({
          id: 'inst-drift',
          namespace: 'team-alpha',
          status: 'failed',
          currentStepId: 'deploy',
          definitionName: 'deploy-flow',
          definitionVersion: '7',
        }),
      );
      await processRepo.saveWorkflowDefinition(
        buildWorkflowDefinition({
          name: 'deploy-flow',
          version: 7,
          namespace: 'team-alpha',
          steps: [{ id: 'deploy', name: 'Deploy', type: 'creation', executor: 'agent', agentId: 'ship-it-agent', agentVersion: opts.pinnedVersion }],
        }),
      );
      await agentRunRepo.create(
        buildAgentRun({
          id: 'agent-run-1',
          processInstanceId: 'inst-drift',
          stepId: 'deploy',
          agentId: 'ship-it-agent',
          agentVersion: opts.ranVersion,
        }),
      );
      await agentDefinitionRepo.upsert('ship-it-agent', {
        kind: 'plugin',
        name: 'Ship It',
        iconName: 'bot',
        description: '',
        foundationModel: 'anthropic/claude-sonnet-4',
        systemPrompt: 'Ship it.',
        inputDescription: '',
        outputDescription: '',
        namespace: 'team-alpha',
        visibility: 'private',
      });
      await agentDefinitionRepo.appendVersion({
        agentId: 'ship-it-agent',
        version: opts.currentVersion,
        hash: 'a'.repeat(64),
        config: {
          kind: 'plugin',
          runtimeId: null,
          foundationModel: 'anthropic/claude-sonnet-4',
          systemPrompt: 'Ship it.',
          mcpServers: {},
          skills: [],
        },
        createdBy: 'author-1',
        createdAt: '2026-01-01T00:00:00.000Z',
      });

      const scope = createTestScope({
        instanceRepo: driftInstanceRepo,
        auditRepo: driftAuditRepo,
        agentRunRepo,
        agentDefinitionRepo,
        processRepo,
        runKicker: noopRunKicker(),
        caller: userCaller('u-1', ['team-alpha']),
      });
      const instanceAfter: ProcessInstance = {
        ...(await driftInstanceRepo.getById('inst-drift'))!,
        status: 'running',
        error: null,
      };
      const engineStub = makeEngineStub({ result: instanceAfter });
      Object.assign(scope.system, { engine: engineStub });
      return { scope, engineStub };
    }

    it('[ERROR] refuses to retry when the Agent changed since this step last ran', async () => {
      const { scope, engineStub } = await buildDriftScope({ ranVersion: 2, currentVersion: 3 });

      const err = await retryStep({ runId: 'inst-drift', stepId: 'deploy' }, scope).catch((e) => e);

      expect(err).toBeInstanceOf(PreconditionFailedError);
      expect((err as Error).message).toContain('ran v2, now v3');
      expect(engineStub.calls).toHaveLength(0);
    });

    it('[DATA] retries on the current Agent when allowAgentDrift is set', async () => {
      const { scope, engineStub } = await buildDriftScope({ ranVersion: 2, currentVersion: 3 });

      const result = await retryStep({ runId: 'inst-drift', stepId: 'deploy', allowAgentDrift: true }, scope);

      expect(result.run.status).toBe('running');
      expect(engineStub.calls).toHaveLength(1);
    });

    it('[DATA] retries normally when the Agent has not changed', async () => {
      const { scope, engineStub } = await buildDriftScope({ ranVersion: 3, currentVersion: 3 });

      await retryStep({ runId: 'inst-drift', stepId: 'deploy' }, scope);

      expect(engineStub.calls).toHaveLength(1);
    });

    it('[DATA] retries normally on a pinned step even though the Agent moved past its pin', async () => {
      const { scope, engineStub } = await buildDriftScope({ ranVersion: 2, currentVersion: 3, pinnedVersion: 2 });

      await retryStep({ runId: 'inst-drift', stepId: 'deploy' }, scope);

      expect(engineStub.calls).toHaveLength(1);
    });
  });
});
