import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryAuthService,
  RbacService,
  RbacError,
  type StepConfig,
  type ProcessDefinition,
} from '@mediforce/platform-core';
import { WorkflowEngine } from '../engine/workflow-engine.js';
import type { StepActor } from '../index.js';

// A simple 2-step process (start -> done) with no gate needed (single transition)
const simpleDefinition: ProcessDefinition = {
  name: 'rbac-test-process',
  version: '1.0',
  steps: [
    { id: 'start', name: 'Start', type: 'creation' },
    { id: 'done', name: 'Done', type: 'terminal' },
  ],
  transitions: [{ from: 'start', to: 'done' }],
  triggers: [{ type: 'manual', name: 'Start RBAC Test' }],
};

const actor: StepActor = { id: 'user-1', role: 'operator' };

const stepConfigWithRoles: StepConfig = {
  stepId: 'start',
  executorType: 'human',
  allowedRoles: ['approver'],
};

const stepConfigNoRoles: StepConfig = {
  stepId: 'start',
  executorType: 'human',
};

describe('WorkflowEngine — RBAC enforcement', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let authService: InMemoryAuthService;
  let rbacService: RbacService;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    authService = new InMemoryAuthService();
    rbacService = new RbacService(authService);

    await processRepo.saveProcessDefinition(simpleDefinition);
  });

  /**
   * Helper: create + start an instance and return its id.
   */
  async function startFreshInstance(): Promise<string> {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );
    const instance = await engine.createInstance(
      'rbac-test-process',
      '1.0',
      'system',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    return instance.id;
  }

  // --- Test 1: No rbacService configured — backward compatible ---

  it('succeeds without rbacService configured (backward compatible)', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      // rbacService intentionally omitted
    );
    const instance = await engine.createInstance(
      'rbac-test-process',
      '1.0',
      'system',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);

    // Should succeed even without any user in auth service
    const result = await engine.advanceStep(
      instance.id,
      {},
      actor,
      stepConfigWithRoles,
    );
    expect(result.status).toBe('completed');

    // No access_denied audit event
    const events = auditRepo.getAll();
    const deniedEvent = events.find((e) => e.action === 'rbac.access_denied');
    expect(deniedEvent).toBeUndefined();
  });

  // --- Test 2: No allowedRoles on step — any authenticated user can proceed ---

  it('succeeds when stepConfig has no allowedRoles (any authenticated user)', async () => {
    authService.setCurrentUser({
      uid: 'user-no-roles',
      email: 'user@example.com',
      displayName: null,
      roles: [],
    });

    const instanceId = await startFreshInstance();
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );

    const result = await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigNoRoles,
    );
    expect(result.status).toBe('completed');

    // No access_denied audit event
    const events = auditRepo.getAll();
    const deniedEvent = events.find((e) => e.action === 'rbac.access_denied');
    expect(deniedEvent).toBeUndefined();
  });

  // --- Test 3: User has required role — proceeds normally ---

  it('succeeds when user has the required role', async () => {
    authService.setCurrentUser({
      uid: 'approver-user',
      email: 'approver@example.com',
      displayName: 'Approver User',
      roles: ['approver', 'reader'],
    });

    const instanceId = await startFreshInstance();
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );

    const result = await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRoles,
    );
    expect(result.status).toBe('completed');

    // No access_denied audit event
    const events = auditRepo.getAll();
    const deniedEvent = events.find((e) => e.action === 'rbac.access_denied');
    expect(deniedEvent).toBeUndefined();
  });

  // --- Test 4: User lacks required role — throws RbacError + audit event ---

  it('throws RbacError and appends rbac.access_denied audit event when user lacks required role', async () => {
    authService.setCurrentUser({
      uid: 'reader-user',
      email: 'reader@example.com',
      displayName: null,
      roles: ['reader'],
    });

    const instanceId = await startFreshInstance();
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );

    await expect(
      engine.advanceStep(instanceId, {}, actor, stepConfigWithRoles),
    ).rejects.toThrow(RbacError);

    // One access_denied audit event with correct fields
    const events = auditRepo.getAll();
    const deniedEvent = events.find((e) => e.action === 'rbac.access_denied');
    expect(deniedEvent).toBeDefined();
    expect(deniedEvent!.actorId).toBe('reader-user');
    expect(deniedEvent!.stepId).toBe('start');
    expect(deniedEvent!.inputSnapshot).toMatchObject({
      stepId: 'start',
      requiredRoles: ['approver'],
    });
    expect(deniedEvent!.outputSnapshot).toMatchObject({
      userRoles: ['reader'],
    });
    expect(deniedEvent!.processInstanceId).toBe(instanceId);
    expect(deniedEvent!.basis).toBe('RBAC enforcement: user lacks required role');
  });

  // --- Test 5: Unauthenticated user — throws when rbacService is present ---

  it('throws when user is unauthenticated and rbacService is configured', async () => {
    // No user set in authService — requireAuth will throw
    authService.setCurrentUser(null);

    const instanceId = await startFreshInstance();
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );

    // Should throw (requireAuth throws "Authentication required")
    await expect(
      engine.advanceStep(instanceId, {}, actor, stepConfigWithRoles),
    ).rejects.toThrow('Authentication required');
  });

  // --- Test 6: stepConfig not passed — RBAC check skipped ---

  it('skips RBAC check when stepConfig is not passed, even with rbacService configured', async () => {
    // User has no roles at all, but RBAC should not fire without stepConfig
    authService.setCurrentUser(null);

    const instanceId = await startFreshInstance();
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      rbacService,
    );

    // No stepConfig passed — should succeed without RBAC check
    const result = await engine.advanceStep(instanceId, {}, actor);
    expect(result.status).toBe('completed');

    const events = auditRepo.getAll();
    const deniedEvent = events.find((e) => e.action === 'rbac.access_denied');
    expect(deniedEvent).toBeUndefined();
  });
});
