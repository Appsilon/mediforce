import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../index';

const def: WorkflowDefinition = {
  name: 'ae-grading',
  version: 2,
  namespace: 'pharma-a',
  visibility: 'private',
  steps: [
    { id: 'extract-aes', name: 'Extract', type: 'creation', executor: 'agent' },
    { id: 'grade-aes', name: 'Grade', type: 'creation', executor: 'agent' },
    { id: 'notify', name: 'Notify', type: 'creation', executor: 'human' },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'extract-aes', to: 'grade-aes' },
    { from: 'grade-aes', to: 'notify' },
    { from: 'notify', to: 'done' },
  ],
};

describe('eval trials (ADR-0023 D4)', () => {
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let engine: WorkflowEngine;

  beforeEach(async () => {
    const processRepo = new InMemoryProcessRepository();
    await processRepo.saveWorkflowDefinition(def);
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository(instanceRepo);
    engine = new WorkflowEngine(processRepo, instanceRepo, auditRepo);
  });

  async function trial() {
    return engine.createEvalTrial({
      namespace: 'pharma-a',
      definitionName: 'ae-grading',
      version: 2,
      stepId: 'grade-aes',
      evalRunId: 'eval-run-1',
      triggerPayload: { studyId: 'CDISCPILOT01' },
      variables: { 'extract-aes': { events: [{ term: 'Sepsis' }] } },
      workspaceStartCommit: 'a1b2c3d4',
      createdBy: 'author-1',
    });
  }

  it('enters the target step directly with the seeded state', async () => {
    const instance = await trial();
    expect(instance).toMatchObject({
      status: 'running',
      currentStepId: 'grade-aes',
      evalRunId: 'eval-run-1',
      workspaceStartCommit: 'a1b2c3d4',
      triggerPayload: { studyId: 'CDISCPILOT01' },
      variables: { 'extract-aes': { events: [{ term: 'Sepsis' }] } },
      definitionVersion: '2',
    });
    const [created] = await auditRepo.getByProcess(instance.id);
    expect(created).toMatchObject({ action: 'instance.created' });
  });

  it('refuses a step the definition does not have', async () => {
    await expect(engine.createEvalTrial({
      namespace: 'pharma-a', definitionName: 'ae-grading', version: 2, stepId: 'nope', evalRunId: 'r',
      triggerPayload: {}, variables: {}, workspaceStartCommit: null, createdBy: 'author-1',
    })).rejects.toThrow("Step 'nope' not found");
  });

  it('ends after the one step, without moving to the next', async () => {
    const instance = await trial();
    await instanceRepo.update(instance.id, { status: 'paused', pauseReason: 'agent_escalated' });

    const finished = await engine.finishEvalTrial(instance.id, 'grade-aes', { failed: false, error: null });
    expect(finished).toMatchObject({ status: 'completed', currentStepId: null, pauseReason: null });

    const failed = await engine.finishEvalTrial((await trial()).id, 'grade-aes', { failed: true, error: 'agent timed out' });
    expect(failed).toMatchObject({ status: 'failed', error: 'agent timed out' });
  });
});
