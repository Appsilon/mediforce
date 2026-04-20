import type {
  ProcessRepository,
  ProcessInstanceRepository,
  AuditRepository,
  ProcessInstance,
  ReviewVerdict,
  StepConfig,
  HandoffRepository,
  HandoffEntity,
  NotificationService,
  NotificationTarget,
  HumanTaskRepository,
  HumanTask,
  CoworkSessionRepository,
  UserDirectoryService,
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';
import type { Selection } from '@mediforce/platform-core';
import { RbacService, RbacError, normalizeSelection } from '@mediforce/platform-core';
import { validateStepGraph } from '../graph/graph-validator.js';
import { StepExecutor, type StepActor } from './step-executor.js';
import { RoutingError, InvalidTransitionError } from './errors.js';
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
    private readonly rbacService?: RbacService,          // optional: Phase 4 RBAC enforcement
    private readonly handoffRepository?: HandoffRepository, // optional: Phase 4 handoff creation on escalation
    private readonly notificationService?: NotificationService, // optional: escalation notifications
    private readonly humanTaskRepository?: HumanTaskRepository, // optional: Phase 4.1 HumanTask creation on human step advance
    private readonly coworkSessionRepository?: CoworkSessionRepository, // optional: cowork session creation on cowork step advance
    private readonly userDirectoryService?: UserDirectoryService, // optional: resolves roles to email targets for notifications
  ) {
    this.stepExecutor = new StepExecutor(instanceRepository, auditRepository);
    this.reviewTracker = new ReviewTracker();
  }

  /**
   * Create a new process instance. Loads WorkflowDefinition to get roles.
   */
  async createInstance(
    definitionName: string,
    version: number,
    triggeredBy: string,
    triggerType: 'manual' | 'webhook' | 'cron',
    payload?: Record<string, unknown>,
  ): Promise<ProcessInstance> {
    const definition = await this.processRepository.getWorkflowDefinition(definitionName, version);
    if (!definition) {
      throw new Error(
        `Workflow definition '${definitionName}' version '${version}' not found`,
      );
    }

    const now = new Date().toISOString();
    const instance: ProcessInstance = {
      id: crypto.randomUUID(),
      definitionName,
      definitionVersion: String(version),
      status: 'created',
      currentStepId: null,
      variables: {},
      triggerType,
      triggerPayload: payload ?? {},
      createdAt: now,
      updatedAt: now,
      createdBy: triggeredBy,
      pauseReason: null,
      error: null,
      assignedRoles: definition.roles ?? [],
    };

    await this.instanceRepository.create(instance);

    await this.auditRepository.append({
      actorId: triggeredBy,
      actorType: 'user',
      actorRole: 'trigger',
      action: 'instance.created',
      description: `Created instance of '${definitionName}' v${version}`,
      timestamp: now,
      inputSnapshot: { definitionName, version, triggerType, payload: payload ?? {} },
      outputSnapshot: { instanceId: instance.id },
      basis: `Triggered by ${triggeredBy} via ${triggerType}`,
      entityType: 'processInstance',
      entityId: instance.id,
      processInstanceId: String(version),
    });

    return instance;
  }

  /**
   * Advance the current step — works with any instance.
   * Loads definition via loadDefinitionUnified (WorkflowDefinition only).
   */
  async advanceStep(
    instanceId: string,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    _stepConfig?: StepConfig,       // ignored — kept for backward compat with callers
    agentRunResult?: AgentRunResult,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'advanceStep');
    }

    const definition = await this.loadDefinitionUnified(instance);
    const workflowStep = definition.steps.find((s) => s.id === instance.currentStepId);

    // RBAC enforcement: check step access before executing
    if (this.rbacService && workflowStep?.allowedRoles) {
      try {
        await this.rbacService.requireStepAccess(
          workflowStep.allowedRoles,
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

    // Handoff creation: when agent escalates, create HandoffEntity before pausing
    if (agentRunResult?.status === 'escalated' && this.handoffRepository) {
      const handoff: HandoffEntity = {
        id: crypto.randomUUID(),
        type: 'agent_escalation',
        processInstanceId: instanceId,
        stepId: instance.currentStepId!,
        agentRunId: agentRunResult.agentRunId ?? 'unknown',
        assignedRole: workflowStep?.allowedRoles?.[0] ?? 'reviewer',
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

      // Send escalation notification using definition.notifications
      if (this.notificationService && this.userDirectoryService) {
        const escalationConfig = definition.notifications?.find(
          (n) => n.event === 'agent_escalation',
        );
        if (escalationConfig) {
          const targets: NotificationTarget[] = [];
          for (const role of escalationConfig.roles) {
            const users = await this.userDirectoryService.getUsersByRole(role);
            for (const user of users) {
              targets.push({ channel: 'email', address: user.email });
            }
          }
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

      return this.loadInstance(instanceId);
    }

    await this.stepExecutor.executeStep(
      instance,
      stepOutput,
      actor,
      // WorkflowDefinition steps are structurally compatible with ProcessDefinition
      // for routing purposes (same id/type/verdicts/transitions shape)
      this.workflowDefinitionToProcessDefinition(definition),
    );

    // HumanTask creation: create task when next step's executor is 'human'
    if (this.humanTaskRepository) {
      const updatedInstance = await this.loadInstance(instanceId);
      if (updatedInstance.currentStepId !== null) {
        const nextStep = definition.steps.find(
          (s) => s.id === updatedInstance.currentStepId,
        );

        if (nextStep && nextStep.type !== 'terminal' && nextStep.executor === 'human') {
          const assignedRole = nextStep.allowedRoles?.[0] ?? 'unassigned';
          const now = new Date().toISOString();

          const selectionFields: { selection?: Selection; options?: Record<string, unknown>[] } = {};
          if (nextStep.selection !== undefined) {
            selectionFields.selection = nextStep.selection;
            const prevOutput = updatedInstance.variables[instance.currentStepId!] as Record<string, unknown> | undefined;
            const rawOptions = prevOutput?.options;
            if (Array.isArray(rawOptions) && rawOptions.length > 0) {
              const { min } = normalizeSelection(nextStep.selection);
              if (rawOptions.length < min) {
                throw new Error(
                  `Step "${nextStep.id}" requires selecting at least ${min} but only ${rawOptions.length} options available`,
                );
              }
              selectionFields.options = rawOptions as Record<string, unknown>[];
            }
          }

          const task: HumanTask = {
            id: crypto.randomUUID(),
            processInstanceId: instanceId,
            stepId: nextStep.id,
            assignedRole,
            assignedUserId: updatedInstance.createdBy ?? null,
            status: updatedInstance.createdBy ? 'claimed' : 'pending',
            deadline: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            completionData: null,
            creationReason: 'human_executor',
            ...(nextStep.ui ? { ui: nextStep.ui } : {}),
            ...(nextStep.params?.length ? { params: nextStep.params } : {}),
            ...selectionFields,
          };
          await this.humanTaskRepository.create(task);

          await this.auditRepository.append({
            actorId: 'engine',
            actorType: 'system',
            actorRole: 'orchestrator',
            action: 'task.created',
            description: `Human task created for step '${nextStep.id}' (reason: human_executor)`,
            timestamp: now,
            inputSnapshot: { taskId: task.id, stepId: nextStep.id, reason: 'human_executor', assignedRole },
            outputSnapshot: {},
            basis: 'advanceStep: next step executor is human',
            entityType: 'humanTask',
            entityId: task.id,
            processInstanceId: instanceId,
            processDefinitionVersion: String(definition.version),
          });

          await this.instanceRepository.update(instanceId, {
            status: 'paused',
            pauseReason: 'waiting_for_human',
            updatedAt: now,
          });
        }

        // Note: CoworkSession creation is handled by the auto-runner (route.ts),
        // not by advanceStep. This avoids duplicate sessions when both paths fire.
      }
    }

    return this.loadInstance(instanceId);
  }

  async startInstance(instanceId: string): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'created') {
      throw new InvalidTransitionError(instance.status, 'startInstance');
    }

    const definition = await this.loadDefinitionUnified(instance);
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

    const workflowDef = await this.loadDefinitionUnified(instance);
    const definition = this.workflowDefinitionToProcessDefinition(workflowDef);
    const workflowStep = workflowDef.steps.find((s) => s.id === stepId);
    const maxIterations = workflowStep?.review?.maxIterations;

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

    // Execute step with review verdicts (native verdict routing reads step.verdicts)
    await this.stepExecutor.executeStep(
      instance,
      { verdict: verdict.verdict, comment: verdict.comment },
      actor,
      definition,
      allVerdicts,
    );

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

  /**
   * Retry a failed step in-place: flip the instance back to 'running' so the
   * auto-runner re-enters `currentStepId`. Variables from earlier steps are
   * kept as-is; the retried step will create a fresh StepExecution when the
   * runner dispatches it.
   *
   * Retry is allowed when the instance is 'failed' or 'paused' (the fallback
   * handler pauses on agent errors), the requested step matches
   * `currentStepId`, and the latest execution for that step failed.
   */
  async retryStep(
    instanceId: string,
    stepId: string,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    if (instance.status !== 'failed' && instance.status !== 'paused') {
      throw new InvalidTransitionError(instance.status, 'retryStep');
    }
    if (instance.currentStepId !== stepId) {
      throw new Error(
        `Step '${stepId}' is not the current step (currentStepId='${instance.currentStepId}')`,
      );
    }

    const latestExecution = await this.instanceRepository.getLatestStepExecution(
      instanceId,
      stepId,
    );
    if (!latestExecution || latestExecution.status !== 'failed') {
      throw new Error(
        `Latest execution for step '${stepId}' is not failed (status='${latestExecution?.status ?? 'none'}')`,
      );
    }

    const now = new Date().toISOString();
    await this.instanceRepository.update(instanceId, {
      status: 'running',
      pauseReason: null,
      error: null,
      updatedAt: now,
    });

    await this.auditRepository.append({
      actorId: actor.id,
      actorType: 'user',
      actorRole: actor.role,
      action: 'step.retried',
      description: `Retried failed step '${stepId}' on instance '${instanceId}'`,
      timestamp: now,
      inputSnapshot: { instanceId, stepId, previousError: latestExecution.error },
      outputSnapshot: {},
      basis: 'Operator triggered retry after step failure',
      entityType: 'stepExecution',
      entityId: stepId,
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

  /**
   * Load definition for an instance — always returns WorkflowDefinition.
   * Tries exact version match first, falls back to latest version by name.
   */
  private async loadDefinitionUnified(
    instance: ProcessInstance,
  ): Promise<WorkflowDefinition> {
    const versionNum = parseInt(instance.definitionVersion, 10);
    if (!isNaN(versionNum)) {
      const wd = await this.processRepository.getWorkflowDefinition(
        instance.definitionName,
        versionNum,
      );
      if (wd) return wd;
    }

    // Fallback: latest version by name (handles legacy instances with string versions like "1.0.0")
    const latestVersion = await this.processRepository.getLatestWorkflowVersion(instance.definitionName);
    if (latestVersion > 0) {
      const wd = await this.processRepository.getWorkflowDefinition(instance.definitionName, latestVersion);
      if (wd) return wd;
    }

    throw new Error(
      `No WorkflowDefinition found for '${instance.definitionName}'. Run the migration endpoint first.`,
    );
  }

  /**
   * Adapts a WorkflowDefinition to the ProcessDefinition shape used by StepExecutor.
   * Only routing-relevant fields (id, type, verdicts, transitions, version) are used by StepExecutor.
   */
  private workflowDefinitionToProcessDefinition(
    definition: WorkflowDefinition,
  ): import('@mediforce/platform-core').ProcessDefinition {
    return {
      name: definition.name,
      version: String(definition.version),
      steps: definition.steps.map((step) => ({
        id: step.id,
        name: step.name,
        type: step.type,
        ...(step.verdicts ? { verdicts: step.verdicts } : {}),
        ...(step.selection !== undefined ? { selection: step.selection } : {}),
        ...(step.ui ? { ui: step.ui } : {}),
        ...(step.params ? { params: step.params } : {}),
        ...(step.description ? { description: step.description } : {}),
        ...(step.metadata ? { metadata: step.metadata } : {}),
      })),
      transitions: definition.transitions,
      triggers: definition.triggers,
      ...(definition.description ? { description: definition.description } : {}),
      ...(definition.metadata ? { metadata: definition.metadata } : {}),
    };
  }
}
