import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHumanTaskRepository,
  NoopNotificationService,
} from '@mediforce/platform-core';
import type {
  WorkflowDefinition,
  UserDirectoryService,
  DirectoryUser,
} from '@mediforce/platform-core';
import { WorkflowEngine } from '../workflow-engine';
import type { StepActor } from '../../index';

class InMemoryUserDirectoryService implements UserDirectoryService {
  private users: Array<{ role: string; uid: string; email: string }> = [];

  addUser(role: string, uid: string, email: string): void {
    this.users.push({ role, uid, email });
  }

  async getUsersByRole(role: string): Promise<DirectoryUser[]> {
    return this.users
      .filter((u) => u.role === role)
      .map((u) => ({ uid: u.uid, email: u.email }));
  }

  async resolveUser(identifier: string): Promise<DirectoryUser | null> {
    const match = this.users.find(
      (u) => u.uid === identifier || u.email === identifier,
    );
    return match ? { uid: match.uid, email: match.email } : null;
  }

  async getUserMetadata(
    uid: string,
  ): Promise<{
    email: string | null;
    displayName: string | null;
    lastSignInTime: string | null;
    photoURL: string | null;
  } | null> {
    const match = this.users.find((u) => u.uid === uid);
    if (!match) return null;
    return {
      email: match.email,
      displayName: null,
      lastSignInTime: null,
      photoURL: null,
    };
  }
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
  triggers: [{ type: 'manual', name: 'Start Human Process' }],
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
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined, // rbacService
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

    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');
    // Assignee is NOT a member of the 'reviewer' role.
    userDirectoryService.addUser('operator', 'uid-a1', 'assignee@example.com');

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
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

    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('creator', 'user-1', 'creator@example.com');

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
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
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

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
      const userDirectoryService = new InMemoryUserDirectoryService();
      userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');
      userDirectoryService.addUser('operator', 'uid-a1', 'assignee@example.com');

      const engine = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
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
      const userDirectoryService = new InMemoryUserDirectoryService();
      userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

      const engine = new WorkflowEngine(
        processRepo,
        instanceRepo,
        auditRepo,
        undefined,
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
});
