import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemoryProcessRepository,
  InMemoryProcessInstanceRepository,
  InMemoryAuditRepository,
  InMemoryHandoffRepository,
  NoopNotificationService,
} from '@mediforce/platform-core';
import type {
  ProcessDefinition,
  ProcessConfig,
  StepConfig,
  UserDirectoryService,
  DirectoryUser,
} from '@mediforce/platform-core';
import { WorkflowEngine } from '../workflow-engine.js';
import type { StepActor, AgentRunResult } from '../../index.js';

// In-memory test double for UserDirectoryService (not exported, test-only)
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
}

// A 2-step process: agent-step -> done
const agentProcessDef: ProcessDefinition = {
  name: 'agent-process',
  version: '1.0',
  steps: [
    { id: 'agent-step', name: 'Agent Step', type: 'creation' },
    { id: 'done', name: 'Done', type: 'terminal' },
  ],
  transitions: [{ from: 'agent-step', to: 'done' }],
  triggers: [{ type: 'manual', name: 'Start Agent Process' }],
};

const actor: StepActor = { id: 'agent:example-agent', role: 'agent' };

const stepConfigWithRole: StepConfig = {
  stepId: 'agent-step',
  executorType: 'agent',
  allowedRoles: ['reviewer'],
  fallbackBehavior: 'escalate_to_human',
};

const escalatedResult: AgentRunResult = {
  status: 'escalated',
  envelope: null,
  appliedToWorkflow: false,
  fallbackReason: 'low_confidence',
  agentRunId: 'run-001',
};

const escalatedWithEnvelope: AgentRunResult = {
  status: 'escalated',
  envelope: {
    result: { analysis: 'partial result from agent' },
    reasoning_summary: 'Confidence too low to proceed automatically',
    model: 'claude-sonnet-4',
    confidence: 0.3,
  },
  appliedToWorkflow: false,
  fallbackReason: 'low_confidence',
  agentRunId: 'run-002',
};

const timeoutEscalatedResult: AgentRunResult = {
  status: 'escalated',
  envelope: null,
  appliedToWorkflow: false,
  fallbackReason: 'timeout',
  agentRunId: 'run-003',
};

describe('WorkflowEngine — agent escalation handoff creation', () => {
  let processRepo: InMemoryProcessRepository;
  let instanceRepo: InMemoryProcessInstanceRepository;
  let auditRepo: InMemoryAuditRepository;
  let handoffRepo: InMemoryHandoffRepository;
  let notificationService: NoopNotificationService;

  beforeEach(async () => {
    processRepo = new InMemoryProcessRepository();
    instanceRepo = new InMemoryProcessInstanceRepository();
    auditRepo = new InMemoryAuditRepository();
    handoffRepo = new InMemoryHandoffRepository();
    notificationService = new NoopNotificationService();

    await processRepo.saveProcessDefinition(agentProcessDef);
  });

  /**
   * Helper: create + start a fresh instance, set it to paused/agent_escalated state
   * to simulate what FallbackHandler does before WorkflowEngine.advanceStep is called.
   */
  async function createRunningInstance(engine: WorkflowEngine): Promise<string> {
    const instance = await engine.createInstance(
      'agent-process',
      '1.0',
      'system',
      'manual',
      {},
    );
    await engine.startInstance(instance.id);
    return instance.id;
  }

  // Helper: simulate FallbackHandler pausing the instance (what happens before advanceStep)
  async function simulateFallbackPause(instanceId: string): Promise<void> {
    await instanceRepo.update(instanceId, {
      status: 'paused',
      pauseReason: 'agent_escalated',
    });
  }

  // --- Test 1: Escalation with handoffRepository — HandoffEntity created ---

  it('creates HandoffEntity with status=created when agent escalates with handoffRepository', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined, // no rbacService
      handoffRepo,
      notificationService,
    );

    const instanceId = await createRunningInstance(engine);

    // Simulate FallbackHandler already paused the instance
    await simulateFallbackPause(instanceId);

    // Re-mark instance as running to call advanceStep (engine checks status)
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedResult,
    );

    const handoffs = handoffRepo.getAll();
    expect(handoffs).toHaveLength(1);

    const handoff = handoffs[0];
    expect(handoff.status).toBe('created');
    expect(handoff.processInstanceId).toBe(instanceId);
    expect(handoff.stepId).toBe('agent-step');
    expect(handoff.agentRunId).toBe('run-001');
    expect(handoff.assignedRole).toBe('reviewer');   // from stepConfig.allowedRoles[0]
    expect(handoff.assignedUserId).toBeNull();
    expect(handoff.type).toBe('agent_escalation');
    expect(handoff.agentQuestion).toContain('confidence');
    expect(handoff.resolution).toBeNull();
    expect(handoff.resolvedAt).toBeNull();
    expect(handoff.createdAt).toBeDefined();
    expect(handoff.updatedAt).toBeDefined();
  });

  // --- Test 2: Escalation with envelope — agentWork and agentReasoning populated ---

  it('populates agentWork and agentReasoning from envelope when escalation has result', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedWithEnvelope,
    );

    const handoffs = handoffRepo.getAll();
    expect(handoffs).toHaveLength(1);
    const handoff = handoffs[0];

    expect(handoff.agentWork).toEqual({ analysis: 'partial result from agent' });
    expect(handoff.agentReasoning).toBe('Confidence too low to proceed automatically');
    expect(handoff.agentQuestion).toContain('confidence');
  });

  // --- Test 3: Escalation without handoffRepository — no error (graceful degradation) ---

  it('does not throw when agent escalates but no handoffRepository configured', async () => {
    const engineNoHandoff = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined, // no rbacService
      undefined, // no handoffRepository
      undefined, // no notificationService
    );

    const instanceId = await createRunningInstance(engineNoHandoff);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    // Should not throw — gracefully degrades when no handoffRepository
    await expect(
      engineNoHandoff.advanceStep(
        instanceId,
        {},
        actor,
        stepConfigWithRole,
        escalatedResult,
      ),
    ).resolves.toBeDefined();

    // No handoffs stored (no repository configured)
    expect(handoffRepo.getAll()).toHaveLength(0);
  });

  // --- Test 4: NotificationService.send() called with resolved targets on escalation ---

  it('calls NotificationService.send() with agent_escalation event when both services injected', async () => {
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

    // Save process config with escalation notification config
    const processConfig: ProcessConfig = {
      processName: 'agent-process',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [],
      notifications: [{ event: 'agent_escalation', roles: ['reviewer'] }],
    };
    await processRepo.saveProcessConfig(processConfig);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
      undefined, // humanTaskRepository
      userDirectoryService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedResult,
    );

    // Notification was sent with resolved targets
    expect(notificationService.sent).toHaveLength(1);
    const sent = notificationService.sent[0];
    expect(sent.event.type).toBe('agent_escalation');
    expect(sent.event.processInstanceId).toBe(instanceId);
    expect(sent.event.stepId).toBe('agent-step');
    expect(sent.event.assignedRole).toBe('reviewer');
    expect(sent.targets).toContainEqual({ channel: 'email', address: 'reviewer@example.com' });
  });

  // --- Test 5: Timeout escalation has correct agentQuestion ---

  it('sets agentQuestion to timeout message when fallbackReason is timeout', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      timeoutEscalatedResult,
    );

    const handoffs = handoffRepo.getAll();
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0].agentQuestion).toContain('timed out');
  });

  // --- Test 6: Non-escalated AgentRunResult — normal step execution proceeds ---

  it('does not create HandoffEntity when agentRunResult.status is not escalated', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
    );

    const instanceId = await createRunningInstance(engine);

    const completedResult: AgentRunResult = {
      status: 'completed',
      envelope: { result: { answer: 42 }, reasoning_summary: 'success', model: null, confidence: 0.9 },
      appliedToWorkflow: true,
      fallbackReason: null,
    };

    // Should proceed normally through StepExecutor (no escalation)
    const result = await engine.advanceStep(
      instanceId,
      { answer: 42 },
      actor,
      stepConfigWithRole,
      completedResult,
    );

    expect(result.status).toBe('completed');
    expect(handoffRepo.getAll()).toHaveLength(0);
    expect(notificationService.sent).toHaveLength(0);
  });

  // --- Test 7: Notification targets resolved from roles ---

  it('resolves roles to email targets and sends notification with concrete targets', async () => {
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('supervisor', 'uid-s1', 'supervisor@example.com');

    const processConfig: ProcessConfig = {
      processName: 'agent-process',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [],
      notifications: [{ event: 'agent_escalation', roles: ['supervisor'] }],
    };
    await processRepo.saveProcessConfig(processConfig);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
      undefined, // humanTaskRepository
      userDirectoryService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedResult,
    );

    expect(notificationService.sent).toHaveLength(1);
    expect(notificationService.sent[0].targets).toContainEqual({
      channel: 'email',
      address: 'supervisor@example.com',
    });
  });

  // --- Test 8: No notification when userDirectoryService not injected ---

  it('skips notification when userDirectoryService is not injected (no error thrown)', async () => {
    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
      undefined, // humanTaskRepository
      undefined, // no userDirectoryService
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedResult,
    );

    // Notification skipped — no targets resolved because userDirectoryService absent
    expect(notificationService.sent).toHaveLength(0);
  });

  // --- Test 9: Notification failure propagates (fatal) ---

  it('propagates notification failure as advanceStep failure (fatal — no catch)', async () => {
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

    const processConfig: ProcessConfig = {
      processName: 'agent-process',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [],
      notifications: [{ event: 'agent_escalation', roles: ['reviewer'] }],
    };
    await processRepo.saveProcessConfig(processConfig);

    const failingNotificationService = {
      sent: [] as Array<{ event: unknown; targets: unknown[] }>,
      async send(): Promise<void> {
        throw new Error('SMTP failed');
      },
    };

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      failingNotificationService,
      undefined,
      userDirectoryService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await expect(
      engine.advanceStep(instanceId, {}, actor, stepConfigWithRole, escalatedResult),
    ).rejects.toThrow('SMTP failed');
  });

  // --- Test 10: No notification when no escalation config in ProcessConfig ---

  it('skips notification gracefully when no agent_escalation config in ProcessConfig', async () => {
    const userDirectoryService = new InMemoryUserDirectoryService();
    userDirectoryService.addUser('reviewer', 'uid-r1', 'reviewer@example.com');

    // ProcessConfig with empty notifications array — no agent_escalation entry
    const processConfig: ProcessConfig = {
      processName: 'agent-process',
      configName: 'default',
      configVersion: '1.0',
      stepConfigs: [],
      notifications: [],
    };
    await processRepo.saveProcessConfig(processConfig);

    const engine = new WorkflowEngine(
      processRepo,
      instanceRepo,
      auditRepo,
      undefined,
      handoffRepo,
      notificationService,
      undefined,
      userDirectoryService,
    );

    const instanceId = await createRunningInstance(engine);
    await instanceRepo.update(instanceId, { status: 'running', pauseReason: null });

    await engine.advanceStep(
      instanceId,
      {},
      actor,
      stepConfigWithRole,
      escalatedResult,
    );

    // No error thrown, no notification sent (no roles to resolve)
    expect(notificationService.sent).toHaveLength(0);
  });
});
