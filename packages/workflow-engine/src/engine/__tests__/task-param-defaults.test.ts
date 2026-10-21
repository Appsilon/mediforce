import { describe, it, expect } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  NoopNotificationService,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../workflow-engine';

const draftReviewDef: WorkflowDefinition = {
  name: 'query-email',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'draft-email', name: 'Draft email', type: 'creation', executor: 'agent' },
    {
      id: 'edit-email',
      name: 'Edit email',
      type: 'creation',
      executor: 'human',
      allowedRoles: ['cra'],
      params: [
        { name: 'subject', type: 'string', required: true, default: '[${triggerPayload.studyId}] ${steps.draft-email.subject}' },
        { name: 'body', type: 'textarea', required: true, default: '${steps.draft-email.body}' },
        { name: 'cc', type: 'string', required: false, default: 'monitoring@example.com' },
      ],
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'draft-email', to: 'edit-email' },
    { from: 'edit-email', to: 'done' },
  ],
};

describe('WorkflowEngine — human task param defaults', () => {
  it('resolves ${...} in param defaults against the run when the task is created', async () => {
    const processRepo = new InMemoryProcessRepository();
    const humanTaskRepo = new InMemoryHumanTaskRepository();
    await processRepo.saveWorkflowDefinition(draftReviewDef);
    const engine = new WorkflowEngine(
      processRepo,
      new InMemoryProcessInstanceRepository(),
      new InMemoryAuditRepository(),
      undefined,
      new NoopNotificationService(),
      humanTaskRepo,
    );

    const instance = await engine.createInstance('test', 'query-email', 1, 'user-1', 'manual', { studyId: 'ONC-101' });
    await engine.startInstance(instance.id);
    await engine.advanceStep(
      instance.id,
      { subject: 'Open query on visit 3', body: 'Dear site,\nplease confirm the ALT value.' },
      { id: 'agent-1', role: 'agent' },
    );

    const [task] = humanTaskRepo.getAll();
    expect(task.params?.map((param) => [param.name, param.default])).toEqual([
      ['subject', '[ONC-101] Open query on visit 3'],
      ['body', 'Dear site,\nplease confirm the ALT value.'],
      ['cc', 'monitoring@example.com'],
    ]);
  });
});
