import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../index.js';
import type { StepActor } from '../index.js';

const actor: StepActor = { id: 'user-1', role: 'operator' };

/** Minimal WD with inputForNextRun carrying a cursor from the first step. */
const cursorDef: WorkflowDefinition = {
  name: 'sftp-monitor',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'scan', name: 'Scan SFTP', type: 'creation', executor: 'agent' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'scan', to: 'done' }],
  triggers: [{ type: 'manual', name: 'Start' }],
  inputForNextRun: [{ stepId: 'scan', output: 'cursor', as: 'cursor' }],
};

/** WD without inputForNextRun — baseline, carry-over must be inactive. */
const plainDef: WorkflowDefinition = {
  name: 'plain-process',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 'a', name: 'A', type: 'creation', executor: 'agent' },
    { id: 'b', name: 'B', type: 'terminal', executor: 'human' },
  ],
  transitions: [{ from: 'a', to: 'b' }],
  triggers: [{ type: 'manual', name: 'Start' }],
};

/** WD carrying multiple outputs (some from different steps). */
const multiDef: WorkflowDefinition = {
  name: 'multi-carry',
  version: 1,
  namespace: 'test',
  steps: [
    { id: 's1', name: 'S1', type: 'creation', executor: 'agent' },
    { id: 's2', name: 'S2', type: 'creation', executor: 'agent' },
    { id: 'end', name: 'End', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 's1', to: 's2' },
    { from: 's2', to: 'end' },
  ],
  triggers: [{ type: 'manual', name: 'Start' }],
  inputForNextRun: [
    { stepId: 's1', output: 'cursor', as: 'cursor' },
    { stepId: 's2', output: 'hash', as: 'lastHash' },
  ],
};

describe('Previous run outputs (inputForNextRun)', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);

    await processRepo.saveWorkflowDefinition(cursorDef);
    await processRepo.saveWorkflowDefinition(plainDef);
    await processRepo.saveWorkflowDefinition(multiDef);
  });

  /** Drive an instance through to completed terminal state. */
  async function completeRun(
    defName: string,
    version: number,
    stepOutputs: Array<Record<string, unknown>>,
  ): Promise<string> {
    const instance = await engine.createInstance(
      defName,
      version,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    for (const output of stepOutputs) {
      await engine.advanceStep(instance.id, output, actor);
    }
    return instance.id;
  }

  describe('first run (no predecessor)', () => {
    it('WD without inputForNextRun: previousRun is undefined', async () => {
      const instance = await engine.createInstance(
        'plain-process',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(instance.previousRun).toBeUndefined();
      expect(instance.previousRunSourceId).toBeUndefined();
    });

    it('WD with inputForNextRun, no prior runs: previousRun is empty object', async () => {
      const instance = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(instance.previousRun).toEqual({});
      expect(instance.previousRunSourceId).toBeUndefined();
    });
  });

  describe('second run reads outputs from last completed run', () => {
    it('carries a single output under its exposed name', async () => {
      const firstId = await completeRun('sftp-monitor', 1, [
        { cursor: '2026-04-20T10:00:00Z' }, // scan output; routes into terminal `done` auto-completing
      ]);

      const second = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(second.previousRun).toEqual({ cursor: '2026-04-20T10:00:00Z' });
      expect(second.previousRunSourceId).toBe(firstId);
    });

    it('carries outputs from different steps', async () => {
      const firstId = await completeRun('multi-carry', 1, [
        { cursor: 42 },
        { hash: 'abc123', other: 'ignored' },
      ]);

      const second = await engine.createInstance(
        'multi-carry',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(second.previousRun).toEqual({ cursor: 42, lastHash: 'abc123' });
      expect(second.previousRunSourceId).toBe(firstId);
    });

    it('omits keys when the referenced output was not produced', async () => {
      // First run only produces cursor on s1; s2 output lacks `hash`.
      await completeRun('multi-carry', 1, [
        { cursor: 7 },
        { somethingElse: true }, // no `hash`
      ]);

      const second = await engine.createInstance(
        'multi-carry',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(second.previousRun).toEqual({ cursor: 7 });
      expect(second.previousRun).not.toHaveProperty('lastHash');
    });
  });

  describe('only successful runs count', () => {
    it('skips a failed predecessor and uses the prior completed run', async () => {
      // First run completes with cursor=1
      const firstId = await completeRun('sftp-monitor', 1, [{ cursor: 1 }]);

      // Second run: created, started, but aborted (becomes failed)
      const failing = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      await engine.startInstance(failing.id);
      await engine.abortInstance(failing.id, actor);

      // Third run should inherit from the first (skipping the failed second)
      const third = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(third.previousRun).toEqual({ cursor: 1 });
      expect(third.previousRunSourceId).toBe(firstId);
    });

    it('when only failed runs exist, previousRun is empty', async () => {
      const failing = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      await engine.startInstance(failing.id);
      await engine.abortInstance(failing.id, actor);

      const next = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(next.previousRun).toEqual({});
      expect(next.previousRunSourceId).toBeUndefined();
    });
  });

  describe('most recent completed run wins', () => {
    it('uses the run with the latest completion time', async () => {
      await completeRun('sftp-monitor', 1, [{ cursor: 1 }]);
      // Wait to ensure distinct updatedAt timestamps
      await new Promise((r) => setTimeout(r, 5));
      const secondId = await completeRun('sftp-monitor', 1, [{ cursor: 2 }]);

      const third = await engine.createInstance(
        'sftp-monitor',
        1,
        'user-1',
        'manual',
        {},
      );
      expect(third.previousRun).toEqual({ cursor: 2 });
      expect(third.previousRunSourceId).toBe(secondId);
    });
  });

  describe('version independence (chain per name)', () => {
    it('carries outputs from previous version of the same workflow name', async () => {
      // v1 completes
      const v1Id = await completeRun('sftp-monitor', 1, [
        { cursor: 'v1-value' },
      ]);

      // Register v2 with the same inputForNextRun shape
      const v2Def: WorkflowDefinition = { ...cursorDef, version: 2 };
      await processRepo.saveWorkflowDefinition(v2Def);

      const v2Instance = await engine.createInstance(
        'sftp-monitor',
        2,
        'user-1',
        'manual',
        {},
      );
      expect(v2Instance.previousRun).toEqual({ cursor: 'v1-value' });
      expect(v2Instance.previousRunSourceId).toBe(v1Id);
    });
  });
});
