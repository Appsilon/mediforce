import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  NoopNotificationService,
  InMemoryUserDirectoryService,
} from '@mediforce/platform-core';
import type { WorkflowDefinition } from '@mediforce/platform-core';
import { WorkflowEngine } from '../workflow-engine';
import type { StepActor } from '../../index';

const WORKFLOW_NAMESPACE = 'test';

/**
 * The shared in-memory directory (`@mediforce/platform-core/testing`), seeded
 * for one workspace. Every grant is workspace-wide (`workflowName: null`), so
 * these notification tests keep asserting what they always asserted: role
 * membership decides who is emailed. Scoping a grant to one workflow is
 * covered where it belongs — the directory's own parity contract.
 */
function directoryWith(
  ...grants: ReadonlyArray<readonly [role: string, uid: string, email: string]>
): InMemoryUserDirectoryService {
  const directory = new InMemoryUserDirectoryService();
  for (const [role, uid, email] of grants) {
    directory.addUser({ uid, email });
    directory.addRole(uid, WORKFLOW_NAMESPACE, role);
  }
  return directory;
}

const humanProcessDef: WorkflowDefinition = {
  name: 'human-process',
  version: 1,
  namespace: 'test',
  visibility: 'private',
  steps: [
    { id: 'start', name: 'Start', type: 'creation', executor: 'agent' },
    {
      id: 'review',
      name: 'Review',
      type: 'creation',
      executor: 'human',
      allowedRoles: ['reviewer'],
    },
    { id: 'done', name: 'Done', type: 'terminal', executor: 'human' },
  ],
  transitions: [
    { from: 'start', to: 'review' },
    { from: 'review', to: 'done' },
  ],
  notifications: [{ event: 'task_assigned', roles: ['reviewer'] }],
};

const actor: StepActor = { id: 'user-1', role: 'operator' };

describe('WorkflowEngine — task_assigned notification dispatch', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let humanTaskRepo: InMemoryHumanTaskRepository;
  let notificationService: NoopNotificationService;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    humanTaskRepo = new InMemoryHumanTaskRepository();
    notificationService = new NoopNotificationService();

    await processRepo.saveWorkflowDefinition(humanProcessDef);
  });

  it('dispatches task_assigned notification to resolved role members when a human task is created', async () => {
    const userDirectoryService = directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com']);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined, // handoffRepository
      notificationService,
      humanTaskRepo,
      undefined, // coworkSessionRepository
      userDirectoryService,
    );

    const instance = await engine.createInstance(
      'test',
      'human-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    // Advance from 'start' (agent) -> 'review' (human): creates HumanTask
    await engine.advanceStep(instance.id, { result: 'done' }, actor);

    const tasks = humanTaskRepo.getAll();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].stepId).toBe('review');

    expect(notificationService.sent).toHaveLength(1);
    const sent = notificationService.sent[0];
    expect(sent.event.type).toBe('task_assigned');
    expect(sent.event.processInstanceId).toBe(instance.id);
    expect(sent.event.stepId).toBe('review');
    expect(sent.event.assignedRole).toBe('reviewer');
    expect(sent.event.entityId).toBe(tasks[0].id);
    expect(sent.targets).toContainEqual({
      channel: 'email',
      address: 'reviewer@example.com',
    });
  });

  it('also notifies the pre-assigned user when assignedTo resolves to someone outside the notified roles', async () => {
    const assignedProcessDef: WorkflowDefinition = {
      ...humanProcessDef,
      name: 'human-process-assigned',
      steps: humanProcessDef.steps.map((step) =>
        step.id === 'review'
          ? { ...step, assignedTo: '${triggerPayload.assignee}' }
          : step,
      ),
    };
    await processRepo.saveWorkflowDefinition(assignedProcessDef);

    // Assignee is NOT a member of the 'reviewer' role.
    const userDirectoryService = directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com'], ['operator', 'uid-a1', 'assignee@example.com']);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      notificationService,
      humanTaskRepo,
      undefined,
      userDirectoryService,
    );

    const instance = await engine.createInstance(
      'test',
      'human-process-assigned',
      1,
      'user-1',
      'manual',
      { assignee: 'uid-a1' },
    );
    await engine.startInstance(instance.id);
    await engine.advanceStep(instance.id, { result: 'done' }, actor);

    expect(notificationService.sent).toHaveLength(1);
    const sent = notificationService.sent[0];
    expect(sent.targets).toContainEqual({
      channel: 'email',
      address: 'reviewer@example.com',
    });
    expect(sent.targets).toContainEqual({
      channel: 'email',
      address: 'assignee@example.com',
    });
  });

  it('notifies the fallback assignee (instance creator) when the notified roles are empty', async () => {
    const emptyRolesDef: WorkflowDefinition = {
      ...humanProcessDef,
      name: 'human-process-empty-roles',
      notifications: [{ event: 'task_assigned', roles: [] }],
    };
    await processRepo.saveWorkflowDefinition(emptyRolesDef);

    const userDirectoryService = directoryWith(['creator', 'user-1', 'creator@example.com']);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      notificationService,
      humanTaskRepo,
      undefined,
      userDirectoryService,
    );

    const instance = await engine.createInstance(
      'test',
      'human-process-empty-roles',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    await engine.advanceStep(instance.id, { result: 'done' }, actor);

    expect(notificationService.sent).toHaveLength(1);
    expect(notificationService.sent[0].targets).toContainEqual({
      channel: 'email',
      address: 'creator@example.com',
    });
  });

  it('does not dispatch task_assigned when the workflow declares no such notification', async () => {
    const userDirectoryService = directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com']);

    const noNotifDef: WorkflowDefinition = {
      ...humanProcessDef,
      name: 'human-process-no-notif',
      notifications: [],
    };
    await processRepo.saveWorkflowDefinition(noNotifDef);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      notificationService,
      humanTaskRepo,
      undefined,
      userDirectoryService,
    );

    const instance = await engine.createInstance(
      'test',
      'human-process-no-notif',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    await engine.advanceStep(instance.id, { result: 'done' }, actor);

    // Task still created, but no notification dispatched (opt-in)
    expect(humanTaskRepo.getAll()).toHaveLength(1);
    expect(notificationService.sent).toHaveLength(0);
  });

  it('skips notification when userDirectoryService is not injected', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      notificationService,
      humanTaskRepo,
      undefined, // no coworkSessionRepository
      undefined, // no userDirectoryService
    );

    const instance = await engine.createInstance(
      'test',
      'human-process',
      1,
      'user-1',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    await engine.advanceStep(instance.id, { result: 'done' }, actor);

    expect(humanTaskRepo.getAll()).toHaveLength(1);
    expect(notificationService.sent).toHaveLength(0);
  });

  // The auto-runner (route.ts) creates the task for an already-current human
  // step itself and calls this shared dispatch directly, rather than going
  // through advanceStep. Assignee identifier is the raw resolved `assignedTo`
  // value (uid or email), resolved to an email here.
  describe('dispatchTaskAssignedNotification (shared with auto-runner)', () => {
    it('notifies role members and the assignee for an already-current human step', async () => {
      const userDirectoryService = directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com'], ['operator', 'uid-a1', 'assignee@example.com']);

      const engine = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        notificationService,
        humanTaskRepo,
        undefined,
        userDirectoryService,
      );

      await engine.dispatchTaskAssignedNotification(humanProcessDef, {
        instanceId: 'inst-1',
        stepId: 'review',
        assignedRole: 'reviewer',
        taskId: 'task-1',
        assigneeUserId: 'uid-a1',
      });

      expect(notificationService.sent).toHaveLength(1);
      const sent = notificationService.sent[0];
      expect(sent.event.type).toBe('task_assigned');
      expect(sent.event.entityId).toBe('task-1');
      expect(sent.targets).toContainEqual({
        channel: 'email',
        address: 'reviewer@example.com',
      });
      expect(sent.targets).toContainEqual({
        channel: 'email',
        address: 'assignee@example.com',
      });
    });

    it('is a no-op when the workflow declares no task_assigned notification', async () => {
      const userDirectoryService = directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com']);

      const engine = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
        notificationService,
        humanTaskRepo,
        undefined,
        userDirectoryService,
      );

      await engine.dispatchTaskAssignedNotification(
        { ...humanProcessDef, notifications: [] },
        {
          instanceId: 'inst-1',
          stepId: 'review',
          assignedRole: 'reviewer',
          taskId: 'task-1',
          assigneeUserId: 'uid-a1',
        },
      );

      expect(notificationService.sent).toHaveLength(0);
    });
  });

  // An `assignedTo` that names nobody used to become the task's assignee
  // verbatim, which made a task only a user with that literal id could
  // complete — and no such user exists. The run was then unfinishable by
  // anyone, owner included, because there is no unclaim and no override.
  describe('pre-assignment that cannot be resolved', () => {
  const unresolvableDef: WorkflowDefinition = {
    ...humanProcessDef,
    name: 'human-process-unresolvable',
    steps: humanProcessDef.steps.map((step) =>
      step.id === 'review'
        ? { ...step, assignedTo: 'data-manager@company.com' }
        : step,
    ),
  };

  async function runTo(directory: InMemoryUserDirectoryService) {
    await processRepo.saveWorkflowDefinition(unresolvableDef);
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      notificationService,
      humanTaskRepo,
      undefined,
      directory,
    );
    const instance = await engine.createInstance('test', 'human-process-unresolvable', 1, 'user-1', 'manual', {});
    await engine.startInstance(instance.id);
    await engine.advanceStep(instance.id, { result: 'done' }, actor);
    return humanTaskRepo.getAll();
  }

  it('leaves the task claimable instead of assigning an address as a user', async () => {
    // Nobody in the directory has that address.
    const tasks = await runTo(directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com']));

    expect(tasks).toHaveLength(1);
    expect(tasks[0].assignedUserId).toBeNull();
    expect(tasks[0].status).toBe('pending');
  });

  it('records why it is unassigned, so the run says what went wrong', async () => {
    await runTo(directoryWith(['reviewer', 'uid-r1', 'reviewer@example.com']));

    const entry = auditRepo.getAll().find((e) => e.action === 'task.assignee_unresolved');
    expect(entry?.description).toContain('data-manager@company.com');
  });

  it('still pre-assigns when the address does resolve to a member', async () => {
    const tasks = await runTo(directoryWith(
      ['reviewer', 'uid-r1', 'reviewer@example.com'],
      ['reviewer', 'uid-dm', 'data-manager@company.com'],
    ));

    expect(tasks[0].assignedUserId).toBe('uid-dm');
    expect(tasks[0].status).toBe('claimed');
  });
});
});
