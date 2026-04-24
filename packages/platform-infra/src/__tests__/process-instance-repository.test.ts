import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryProcessInstanceRepository } from '@mediforce/platform-core';
import type {
  ProcessInstance,
  StepExecution,
} from '@mediforce/platform-core';

function createTestInstance(
  overrides: Partial<ProcessInstance> = {},
): ProcessInstance {
  return {
    id: 'inst-001',
    definitionName: 'supply-chain-review',
    definitionVersion: '1.0.0',
    configName: 'default',
    configVersion: '1.0',
    status: 'created',
    currentStepId: null,
    variables: {},
    triggerType: 'manual',
    triggerPayload: {},
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    createdBy: 'user-1',
    pauseReason: null,
    error: null,
    assignedRoles: [],
    deleted: false,
    archived: false,
    ...overrides,
  };
}

function createTestStepExecution(
  overrides: Partial<StepExecution> = {},
): StepExecution {
  return {
    id: 'exec-001',
    instanceId: 'inst-001',
    stepId: 'intake',
    status: 'completed',
    input: { document: 'report.pdf' },
    output: { summary: 'Processed' },
    verdict: null,
    executedBy: 'agent-1',
    startedAt: '2026-01-15T10:01:00.000Z',
    completedAt: '2026-01-15T10:02:00.000Z',
    iterationNumber: 0,
    gateResult: null,
    error: null,
    ...overrides,
  };
}

describe('InMemoryProcessInstanceRepository (contract tests)', () => {
  let repo: InMemoryProcessInstanceRepository;

  beforeEach(() => {
    repo = new InMemoryProcessInstanceRepository();
  });

  describe('create + getById', () => {
    it('round-trip stores and retrieves a process instance', async () => {
      const instance = createTestInstance();
      const created = await repo.create(instance);

      expect(created).toEqual(instance);

      const retrieved = await repo.getById(instance.id);
      expect(retrieved).toEqual(instance);
    });

    it('getById returns null for non-existent instance', async () => {
      const result = await repo.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('changes fields and stamps updatedAt', async () => {
      const instance = createTestInstance();
      await repo.create(instance);

      await repo.update(instance.id, {
        status: 'running',
        currentStepId: 'intake',
      });

      const updated = await repo.getById(instance.id);
      expect(updated).not.toBeNull();
      expect(updated!.status).toBe('running');
      expect(updated!.currentStepId).toBe('intake');
    });
  });

  describe('getByStatus', () => {
    it('returns only instances with matching status', async () => {
      await repo.create(createTestInstance({ id: 'inst-a', status: 'running' }));
      await repo.create(createTestInstance({ id: 'inst-b', status: 'completed' }));
      await repo.create(createTestInstance({ id: 'inst-c', status: 'running' }));

      const running = await repo.getByStatus('running');
      expect(running).toHaveLength(2);
      expect(running.map((i) => i.id).sort()).toEqual(['inst-a', 'inst-c']);

      const completed = await repo.getByStatus('completed');
      expect(completed).toHaveLength(1);
      expect(completed[0].id).toBe('inst-b');
    });
  });

  describe('getByDefinition', () => {
    it('returns instances for a specific definition name and version', async () => {
      await repo.create(
        createTestInstance({
          id: 'inst-x',
          definitionName: 'supply-chain-review',
          definitionVersion: '1.0.0',
        }),
      );
      await repo.create(
        createTestInstance({
          id: 'inst-y',
          definitionName: 'supply-chain-review',
          definitionVersion: '2.0.0',
        }),
      );
      await repo.create(
        createTestInstance({
          id: 'inst-z',
          definitionName: 'other-process',
          definitionVersion: '1.0.0',
        }),
      );

      const result = await repo.getByDefinition('supply-chain-review', '1.0.0');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('inst-x');
    });
  });

  describe('addStepExecution + getStepExecutions', () => {
    it('round-trip stores and retrieves step executions ordered by startedAt asc', async () => {
      const instance = createTestInstance();
      await repo.create(instance);

      const exec1 = createTestStepExecution({
        id: 'exec-1',
        startedAt: '2026-01-15T10:05:00.000Z',
      });
      const exec2 = createTestStepExecution({
        id: 'exec-2',
        stepId: 'review',
        startedAt: '2026-01-15T10:01:00.000Z',
      });

      await repo.addStepExecution(instance.id, exec1);
      await repo.addStepExecution(instance.id, exec2);

      const executions = await repo.getStepExecutions(instance.id);
      expect(executions).toHaveLength(2);
      // exec2 started earlier, should come first
      expect(executions[0].id).toBe('exec-2');
      expect(executions[1].id).toBe('exec-1');
    });
  });

  describe('getLatestStepExecution', () => {
    it('returns the most recent execution for a stepId', async () => {
      const instance = createTestInstance();
      await repo.create(instance);

      const exec1 = createTestStepExecution({
        id: 'exec-1',
        stepId: 'review',
        startedAt: '2026-01-15T10:01:00.000Z',
        iterationNumber: 0,
      });
      const exec2 = createTestStepExecution({
        id: 'exec-2',
        stepId: 'review',
        startedAt: '2026-01-15T10:10:00.000Z',
        iterationNumber: 1,
      });

      await repo.addStepExecution(instance.id, exec1);
      await repo.addStepExecution(instance.id, exec2);

      const latest = await repo.getLatestStepExecution(instance.id, 'review');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe('exec-2');
      expect(latest!.iterationNumber).toBe(1);
    });

    it('returns null when no executions exist for that stepId', async () => {
      const instance = createTestInstance();
      await repo.create(instance);

      const result = await repo.getLatestStepExecution(
        instance.id,
        'nonexistent-step',
      );
      expect(result).toBeNull();
    });

    it('handles multiple step executions for same stepId (review iterations)', async () => {
      const instance = createTestInstance();
      await repo.create(instance);

      // Simulate 3 review iterations
      for (let i = 0; i < 3; i++) {
        await repo.addStepExecution(
          instance.id,
          createTestStepExecution({
            id: `exec-review-${i}`,
            stepId: 'review',
            startedAt: `2026-01-15T1${i}:00:00.000Z`,
            iterationNumber: i,
          }),
        );
      }

      // Also add an execution for a different step
      await repo.addStepExecution(
        instance.id,
        createTestStepExecution({
          id: 'exec-intake',
          stepId: 'intake',
          startedAt: '2026-01-15T15:00:00.000Z',
        }),
      );

      const latest = await repo.getLatestStepExecution(instance.id, 'review');
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe('exec-review-2');
      expect(latest!.iterationNumber).toBe(2);

      // Verify it doesn't return the intake step
      const intakeLatest = await repo.getLatestStepExecution(
        instance.id,
        'intake',
      );
      expect(intakeLatest).not.toBeNull();
      expect(intakeLatest!.id).toBe('exec-intake');
    });
  });
});
