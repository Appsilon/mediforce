import type {
  ProcessRepository,
  ProcessInstanceRepository,
  AuditRepository,
  ProcessInstance,
  ReviewVerdict,
  GateErrorNotifier,
  StepConfig,
  HandoffRepository,
  HandoffEntity,
  NotificationService,
  NotificationTarget,
  HumanTaskRepository,
  HumanTask,
  UserDirectoryService,
} from '@mediforce/platform-core';
import { RbacService, RbacError } from '@mediforce/platform-core';
import type { GateRegistry } from '../gates/gate-registry.js';
import { validateStepGraph } from '../graph/graph-validator.js';
import { StepExecutor, type StepActor } from './step-executor.js';
import { GateError, InvalidTransitionError } from './errors.js';
import { ReviewTracker } from '../review/review-tracker.js';

/**
 * Minimal shape of AgentRunResult needed by WorkflowEngine for handoff creation.
 * Defined here to avoid a hard dependency on @mediforce/agent-runtime.
 * Callers who run agents pass this alongside stepOutput when escalation occurs.
 */
export interface AgentRunResult {
  status: string;  // 'escalated' triggers HandoffEntity creation
  envelope: {
    result?: Record<string, unknown> | null;
    reasoning_summary?: string | null;
    model?: string | null;
    confidence?: number;
  } | null;
  appliedToWorkflow: boolean;
  fallbackReason: 'timeout' | 'low_confidence' | 'error' | null;
  /** Optional: agentRunId for traceability in HandoffEntity */
  agentRunId?: string;
}

/**
 * WorkflowEngine: manages process instance lifecycle.
 *
 * Creates, starts, advances, pauses, resumes, and aborts process instances.
 * Delegates step execution to StepExecutor and review tracking to ReviewTracker.
 */
export class WorkflowEngine {
  private readonly stepExecutor: StepExecutor;
  private readonly reviewTracker: ReviewTracker;

  constructor(
    private readonly processRepository: ProcessRepository,
    private readonly instanceRepository: ProcessInstanceRepository,
    private readonly auditRepository: AuditRepository,
    private readonly gateRegistry: GateRegistry,
    private readonly gateErrorNotifier: GateErrorNotifier,
    private readonly rbacService?: RbacService,          // optional: Phase 4 RBAC enforcement
    private readonly handoffRepository?: HandoffRepository, // optional: Phase 4 handoff creation on escalation
    private readonly notificationService?: NotificationService, // optional: escalation notifications
    private readonly humanTaskRepository?: HumanTaskRepository, // optional: Phase 4.1 HumanTask creation on human step advance
    private readonly userDirectoryService?: UserDirectoryService, // optional: resolves roles to email targets for notifications
  ) {
    this.stepExecutor = new StepExecutor(
      instanceRepository,
      auditRepository,
      gateRegistry,
    );
    this.reviewTracker = new ReviewTracker();
  }

  async createInstance(
    definitionName: string,
    version: string,
    triggeredBy: string,
    triggerType: 'manual' | 'webhook' | 'cron',
    payload: Record<string, unknown>,
    configName = 'default',
    configVersion = '1.0',
  ): Promise<ProcessInstance> {
    // Load and validate definition
    const definition = await this.processRepository.getProcessDefinition(
      definitionName,
      version,
    );
    if (!definition) {
      throw new Error(
        `Process definition '${definitionName}' version '${version}' not found`,
      );
    }

    const validation = validateStepGraph(definition);
    if (!validation.valid) {
      throw new Error(
        `Invalid process definition: ${validation.errors.join(', ')}`,
      );
    }

    const config = await this.processRepository.getProcessConfig(definitionName, configName, configVersion);

    const now = new Date().toISOString();
    const instance: ProcessInstance = {
      id: crypto.randomUUID(),
      definitionName,
      definitionVersion: version,
      configName,
      configVersion,
      status: 'created',
      currentStepId: null,
      variables: {},
      triggerType,
      triggerPayload: payload,
      createdAt: now,
      updatedAt: now,
      createdBy: triggeredBy,
      pauseReason: null,
      error: null,
      assignedRoles: config?.roles ?? [],
    };

    await this.instanceRepository.create(instance);

    await this.auditRepository.append({
      actorId: triggeredBy,
      actorType: 'user',
      actorRole: 'trigger',
      action: 'instance.created',
      description: `Created instance of '${definitionName}' v${version} @ ${configName}:${configVersion}`,
      timestamp: now,
      inputSnapshot: { definitionName, version, triggerType, payload },
      outputSnapshot: { instanceId: instance.id },
      basis: `Triggered by ${triggeredBy} via ${triggerType}`,
      entityType: 'processInstance',
      entityId: instance.id,
      processInstanceId: instance.id,
      processDefinitionVersion: version,
    });

    return instance;
  }

  async startInstance(instanceId: string): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'created') {
      throw new InvalidTransitionError(instance.status, 'startInstance');
    }

    const definition = await this.loadDefinition(
      instance.definitionName,
      instance.definitionVersion,
    );

    const firstStepId = definition.steps[0].id;
    const now = new Date().toISOString();

    await this.instanceRepository.update(instanceId, {
      status: 'running',
      currentStepId: firstStepId,
      updatedAt: now,
    });

    await this.auditRepository.append({
      actorId: instance.createdBy,
      actorType: 'user',
      actorRole: 'trigger',
      action: 'instance.started',
      description: `Started instance '${instanceId}'`,
      timestamp: now,
      inputSnapshot: { instanceId },
      outputSnapshot: { currentStepId: firstStepId },
      basis: 'Instance start',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    return this.loadInstance(instanceId);
  }

  async advanceStep(
    instanceId: string,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    stepConfig?: StepConfig,       // optional: provides allowedRoles for RBAC check
    agentRunResult?: AgentRunResult, // optional: when caller ran an agent and result is 'escalated'
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'advanceStep');
    }

    const definition = await this.loadDefinition(
      instance.definitionName,
      instance.definitionVersion,
    );

    // RBAC enforcement (Phase 4): check step access before executing
    if (this.rbacService && stepConfig) {
      try {
        await this.rbacService.requireStepAccess(
          stepConfig.allowedRoles,
          instance.currentStepId!,
        );
      } catch (err) {
        if (err instanceof RbacError) {
          await this.auditRepository.append({
            actorId: err.userId,
            actorType: 'user',
            actorRole: 'unknown',
            action: 'rbac.access_denied',
            description: `Unauthorized access attempt on step '${err.stepId}'`,
            timestamp: new Date().toISOString(),
            inputSnapshot: { stepId: err.stepId, requiredRoles: err.requiredRoles },
            outputSnapshot: { userRoles: err.userRoles },
            basis: 'RBAC enforcement: user lacks required role',
            entityType: 'processInstance',
            entityId: instanceId,
            processInstanceId: instanceId,
            stepId: err.stepId,
          });
          throw err;
        }
        throw err;
      }
    }

    // Handoff creation (Phase 4): when agent escalates, create HandoffEntity before pausing
    if (agentRunResult?.status === 'escalated' && this.handoffRepository) {
      const handoff: HandoffEntity = {
        id: crypto.randomUUID(),
        type: 'agent_escalation',
        processInstanceId: instanceId,
        stepId: instance.currentStepId!,
        agentRunId: agentRunResult.agentRunId ?? 'unknown',
        assignedRole: stepConfig?.allowedRoles?.[0] ?? 'reviewer',
        assignedUserId: null,
        status: 'created',
        agentWork: (agentRunResult.envelope?.result ?? {}) as Record<string, unknown>,
        agentReasoning: agentRunResult.envelope?.reasoning_summary ?? '',
        agentQuestion: agentRunResult.fallbackReason === 'low_confidence'
          ? 'Agent confidence below threshold — please review'
          : agentRunResult.fallbackReason === 'timeout'
            ? 'Agent timed out — please complete this step manually'
            : 'Agent escalated — please review',
        payload: {},
        resolution: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        resolvedAt: null,
      };
      await this.handoffRepository.create(handoff);

      // Fatal notification with resolved targets: failure propagates to caller
      if (this.notificationService && this.userDirectoryService) {
        const config = await this.processRepository.getProcessConfig(
          instance.definitionName,
          instance.configName,
          instance.configVersion,
        );
        const escalationConfig = config?.notifications?.find(
          (n) => n.event === 'agent_escalation',
        );
        // Graceful skip: no escalation config means no notification
        if (escalationConfig) {
          const targets: NotificationTarget[] = [];
          for (const role of escalationConfig.roles) {
            const users = await this.userDirectoryService.getUsersByRole(role);
            for (const user of users) {
              targets.push({ channel: 'email', address: user.email });
            }
          }
          // FATAL: notification failure propagates — no .catch()
          await this.notificationService.send(
            {
              type: 'agent_escalation',
              processInstanceId: instanceId,
              stepId: instance.currentStepId!,
              assignedRole: handoff.assignedRole,
              entityId: handoff.id,
              timestamp: new Date().toISOString(),
            },
            targets,
          );
        }
      }

      // Return current instance (FallbackHandler already set status='paused', pauseReason='agent_escalated')
      return this.loadInstance(instanceId);
    }

    try {
      await this.stepExecutor.executeStep(
        instance,
        stepOutput,
        actor,
        definition,
      );
    } catch (err) {
      if (err instanceof GateError) {
        await this.gateErrorNotifier.notifyGateError({
          instanceId,
          gateName: err.gateName,
          stepId: instance.currentStepId!,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
        throw err;
      }
      throw err;
    }

    // HumanTask creation: create task when next step's executor is 'human'.
    // Checks executorType from ProcessConfig (not step type from definition),
    // so both 'creation' and 'review' steps with human executors get tasks.
    // Agent steps handle their own task creation (e.g. L3 review tasks in executeAgentStep).
    if (this.humanTaskRepository) {
      const updatedInstance = await this.loadInstance(instanceId);
      if (updatedInstance.currentStepId !== null) {
        const nextStep = definition.steps.find(
          (s) => s.id === updatedInstance.currentStepId,
        );
        if (nextStep && nextStep.type !== 'terminal') {
          const config = await this.processRepository.getProcessConfig(
            updatedInstance.definitionName,
            updatedInstance.configName,
            updatedInstance.configVersion,
          );
          const nextStepConfig = config?.stepConfigs.find(
            (sc) => sc.stepId === nextStep.id,
          );

          // Only create task for human executor steps — agent steps create their own tasks.
          // Requires explicit executorType='human' in config; no config = no auto-task.
          if (nextStepConfig?.executorType === 'human') {
            const assignedRole = nextStepConfig?.allowedRoles?.[0] ?? 'unassigned';

            const now = new Date().toISOString();
            const task: HumanTask = {
              id: crypto.randomUUID(),
              processInstanceId: instanceId,
              stepId: nextStep.id,
              assignedRole,
              assignedUserId: null,
              status: 'pending',
              deadline: null,
              createdAt: now,
              updatedAt: now,
              completedAt: null,
              completionData: null,
              creationReason: 'human_executor',
              ...(nextStep.ui ? { ui: nextStep.ui } : {}),
            };
            await this.humanTaskRepository.create(task);

            // Pause instance to wait for human input
            await this.instanceRepository.update(instanceId, {
              status: 'paused',
              pauseReason: 'waiting_for_human',
              updatedAt: now,
            });
          }
        }
      }
    }

    return this.loadInstance(instanceId);
  }

  async submitReviewVerdict(
    instanceId: string,
    stepId: string,
    verdict: ReviewVerdict,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'submitReviewVerdict');
    }

    const definition = await this.loadDefinition(
      instance.definitionName,
      instance.definitionVersion,
    );

    // Load process config for maxIterations
    const config = await this.processRepository.getProcessConfig(
      instance.definitionName,
      instance.configName,
      instance.configVersion,
    );
    const stepConfig = config?.stepConfigs.find((sc) => sc.stepId === stepId);
    const maxIterations = stepConfig?.reviewConstraints?.maxIterations;

    // Check max iterations BEFORE processing verdict
    if (
      maxIterations !== undefined &&
      this.reviewTracker.isMaxIterationsExceeded(stepId, maxIterations)
    ) {
      const now = new Date().toISOString();
      await this.instanceRepository.update(instanceId, {
        status: 'paused',
        pauseReason: 'max_iterations_exceeded',
        updatedAt: now,
      });

      await this.auditRepository.append({
        actorId: actor.id,
        actorType: 'user',
        actorRole: actor.role,
        action: 'review.max_iterations_exceeded',
        description: `Max iterations (${maxIterations}) exceeded for step '${stepId}'`,
        timestamp: now,
        inputSnapshot: {
          stepId,
          currentIteration:
            this.reviewTracker.getCurrentIteration(stepId),
          maxIterations,
        },
        outputSnapshot: {},
        basis: `Review iteration limit of ${maxIterations} reached`,
        entityType: 'processInstance',
        entityId: instanceId,
        processInstanceId: instanceId,
        stepId,
        processDefinitionVersion: instance.definitionVersion,
      });

      return this.loadInstance(instanceId);
    }

    // Add verdict to tracker
    this.reviewTracker.addVerdict(stepId, verdict);
    const allVerdicts = this.reviewTracker.getVerdicts(stepId);

    // Remember current step before executing
    const previousStepId = instance.currentStepId;

    // Execute step with review verdicts
    try {
      await this.stepExecutor.executeStep(
        instance,
        { verdict: verdict.verdict, comment: verdict.comment },
        actor,
        definition,
        allVerdicts,
      );
    } catch (err) {
      if (err instanceof GateError) {
        await this.gateErrorNotifier.notifyGateError({
          instanceId,
          gateName: err.gateName,
          stepId: instance.currentStepId!,
          error: err.message,
          timestamp: new Date().toISOString(),
        });
        throw err;
      }
      throw err;
    }

    // Check if the step routed back (loop detected) -- increment iteration
    const updatedInstance = await this.loadInstance(instanceId);
    if (
      updatedInstance.currentStepId !== null &&
      updatedInstance.currentStepId !== previousStepId
    ) {
      // If went to a step that comes before review step, it's a loop
      const reviewStepIndex = definition.steps.findIndex(
        (s) => s.id === stepId,
      );
      const nextStepIndex = definition.steps.findIndex(
        (s) => s.id === updatedInstance.currentStepId,
      );
      if (nextStepIndex <= reviewStepIndex) {
        this.reviewTracker.incrementIteration(stepId);
      }
    }

    return updatedInstance;
  }

  async pauseInstance(
    instanceId: string,
    reason: string,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'pauseInstance');
    }

    const now = new Date().toISOString();
    await this.instanceRepository.update(instanceId, {
      status: 'paused',
      pauseReason: reason,
      updatedAt: now,
    });

    await this.auditRepository.append({
      actorId: actor.id,
      actorType: 'user',
      actorRole: actor.role,
      action: 'instance.paused',
      description: `Paused instance '${instanceId}': ${reason}`,
      timestamp: now,
      inputSnapshot: { instanceId, reason },
      outputSnapshot: {},
      basis: `Manual pause: ${reason}`,
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    return this.loadInstance(instanceId);
  }

  async resumeInstance(
    instanceId: string,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'paused') {
      throw new InvalidTransitionError(instance.status, 'resumeInstance');
    }

    const now = new Date().toISOString();
    await this.instanceRepository.update(instanceId, {
      status: 'running',
      pauseReason: null,
      updatedAt: now,
    });

    await this.auditRepository.append({
      actorId: actor.id,
      actorType: 'user',
      actorRole: actor.role,
      action: 'instance.resumed',
      description: `Resumed instance '${instanceId}'`,
      timestamp: now,
      inputSnapshot: { instanceId },
      outputSnapshot: {},
      basis: 'Instance resumed from paused state',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    return this.loadInstance(instanceId);
  }

  async abortInstance(
    instanceId: string,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    const now = new Date().toISOString();
    await this.instanceRepository.update(instanceId, {
      status: 'failed',
      updatedAt: now,
    });

    await this.auditRepository.append({
      actorId: actor.id,
      actorType: 'user',
      actorRole: actor.role,
      action: 'instance.aborted',
      description: `Aborted instance '${instanceId}'`,
      timestamp: now,
      inputSnapshot: { instanceId },
      outputSnapshot: {},
      basis: 'Instance aborted by operator',
      entityType: 'processInstance',
      entityId: instanceId,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    return this.loadInstance(instanceId);
  }

  private async loadInstance(instanceId: string): Promise<ProcessInstance> {
    const instance = await this.instanceRepository.getById(instanceId);
    if (!instance) {
      throw new Error(`Process instance '${instanceId}' not found`);
    }
    return instance;
  }

  private async loadDefinition(
    name: string,
    version: string,
  ): Promise<import('@mediforce/platform-core').ProcessDefinition> {
    const definition = await this.processRepository.getProcessDefinition(
      name,
      version,
    );
    if (!definition) {
      throw new Error(
        `Process definition '${name}' version '${version}' not found`,
      );
    }
    return definition;
  }
}
