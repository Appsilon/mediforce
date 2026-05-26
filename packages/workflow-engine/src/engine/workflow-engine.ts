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
  CompleteHumanTaskPayload,
  CoworkSessionRepository,
  UserDirectoryService,
  WorkflowDefinition,
  WorkflowStep,
} from '@mediforce/platform-core';
import type { Selection, TaskVerdict } from '@mediforce/platform-core';
import { RbacService, RbacError, normalizeSelection, buildTaskVerdicts } from '@mediforce/platform-core';
import { validateStepGraph } from '../graph/graph-validator.js';
import { StepExecutor, type StepActor } from './step-executor.js';
import { RoutingError, InvalidTransitionError } from './errors.js';
import { ReviewTracker } from '../review/review-tracker.js';
import { shapeCompletion } from './complete-human-task.js';

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
    namespace: string,
    definitionName: string,
    version: number,
    triggeredBy: string,
    triggerType: 'manual' | 'webhook' | 'cron',
    payload?: Record<string, unknown>,
  ): Promise<ProcessInstance> {
    const definition = await this.processRepository.getWorkflowDefinition(namespace, definitionName, version);
    if (!definition) {
      throw new Error(
        `Workflow definition '${definitionName}' version '${version}' not found`,
      );
    }

    const now = new Date().toISOString();

    const carryOver = await this.resolvePreviousRunOutputs(definition);

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
      // Explicit write so Firestore docs carry the field — lets
      // getLastCompletedByDefinitionName filter on `deleted == false` server-side
      // without needing a one-time backfill of pre-feature instances.
      deleted: false,
      archived: false,
      namespace: definition.namespace,
      ...(carryOver !== null ? { previousRun: carryOver.values } : {}),
      ...(carryOver?.sourceId !== undefined
        ? { previousRunSourceId: carryOver.sourceId }
        : {}),
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
          const prevOutput = updatedInstance.variables[instance.currentStepId!] as Record<string, unknown> | undefined;
          const rawOptions = prevOutput?.options;
          const opts = Array.isArray(rawOptions) && rawOptions.length > 0
            ? (rawOptions as Record<string, unknown>[])
            : null;

          if (nextStep.selection !== undefined) {
            selectionFields.selection = nextStep.selection;
            if (opts !== null) {
              const { min } = normalizeSelection(nextStep.selection);
              if (opts.length < min) {
                throw new Error(
                  `Step "${nextStep.id}" requires selecting at least ${min} but only ${opts.length} options available`,
                );
              }
            }
          }

          // `options` flow to the task whenever the previous step produced them,
          // not just for selection-style steps. Components like assignment-table
          // consume them as their items list.
          if (opts !== null) {
            selectionFields.options = opts;
          }

          // L3 agent review tasks are created in execute-agent-step, not here;
          // this branch only fires for executor === 'human'. Verdicts are
          // copied onto the task so the form renders without re-reading the WD.
          const verdictsField: { verdicts?: TaskVerdict[] } = {};
          const resolvedVerdicts = buildTaskVerdicts(nextStep.verdicts);
          if (resolvedVerdicts) verdictsField.verdicts = resolvedVerdicts;

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
            ...verdictsField,
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
   * Retry is allowed when the instance is 'failed', or 'paused' with a
   * failure-like pauseReason:
   *   - step_failure, routing_error — set by the legacy step-executor path
   *   - agent_escalated, agent_paused — set by the fallback handler when an
   *     agent plugin errors or escalates (this is the common real-world path:
   *     docker daemon down, network flaky, LLM output invalid)
   *
   * Other pause reasons aren't failures and must be resolved through their
   * own flows: waiting_for_human (user task), missing_env (configure secrets),
   * cowork_in_progress (active session), awaiting_agent_approval (L3 review),
   * max_iterations_exceeded (loop guard — retry wouldn't help).
   *
   * The requested step must match `currentStepId`, and the latest execution
   * for that step must have failed.
   */
  async retryStep(
    instanceId: string,
    stepId: string,
    actor: StepActor,
  ): Promise<ProcessInstance> {
    const instance = await this.loadInstance(instanceId);

    const retryablePauseReasons = new Set([
      'step_failure',
      'routing_error',
      'agent_escalated',
      'agent_paused',
    ]);
    const isFailed = instance.status === 'failed';
    const isRetryablePause =
      instance.status === 'paused' &&
      instance.pauseReason !== null &&
      retryablePauseReasons.has(instance.pauseReason);
    if (!isFailed && !isRetryablePause) {
      throw new InvalidTransitionError(instance.status, 'retryStep');
    }
    if (instance.currentStepId !== stepId) {
      throw new InvalidTransitionError(
        instance.status,
        `retryStep: '${stepId}' is not the current step (currentStepId='${instance.currentStepId}')`,
      );
    }

    const executions = await this.instanceRepository.getStepExecutions(instanceId);
    const latestExecution = executions
      .filter((e) => e.stepId === stepId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0];
    if (!latestExecution || latestExecution.status !== 'failed') {
      throw new InvalidTransitionError(
        instance.status,
        `retryStep: latest execution for '${stepId}' is not failed (status='${latestExecution?.status ?? 'none'}')`,
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
      entityId: latestExecution.id,
      processInstanceId: instanceId,
      processDefinitionVersion: instance.definitionVersion,
    });

    return this.loadInstance(instanceId);
  }

  /**
   * Resolve a `HumanTask` and advance the parent run.
   *
   * Single code path for every task-completion shape (verdict / params /
   * upload / assignment / rows). Auto-claims if the task is still pending,
   * validates the payload against the task's runtime config, persists the
   * completion, resumes the paused parent, and advances the step graph —
   * unless this is an L3-revise verdict, in which case the step stays put
   * so the auto-runner re-executes the agent with reviewer feedback.
   *
   * Audit emission lives in the calling handler per ADR-0005 §7 (handler-
   * resident bridge). This method does not append `task.completed` or
   * `process.resumed_after_task`; the engine still emits `task.created`
   * from `advanceStep` when the next step is human.
   *
   * Throws:
   *   - `CompleteHumanTaskValidationError` — per-variant payload validation
   *     failure (verdict allowlist, requiresComment, file constraints,
   *     selectedIndex range, agent-review empty-output guard, kind/task
   *     mismatch). Adapter maps to HTTP 400.
   *   - `InvalidTransitionError` — task already completed/cancelled, parent
   *     instance not paused. Adapter maps to HTTP 409.
   *   - `Error` — task or parent instance not found. Adapter maps to 500
   *     (handler should pre-load + 404 itself).
   */
  async completeHumanTask(
    taskId: string,
    payload: CompleteHumanTaskPayload,
    actorId: string,
  ): Promise<{
    task: HumanTask;
    instance: ProcessInstance;
    stepOutput: Record<string, unknown>;
    resolvedStepId: string;
    isL3Revise: boolean;
  }> {
    if (!this.humanTaskRepository) {
      throw new Error(
        'completeHumanTask requires humanTaskRepository — engine was constructed without one',
      );
    }

    const task = await this.humanTaskRepository.getById(taskId);
    if (!task) {
      throw new Error(`Task '${taskId}' not found`);
    }
    if (task.status === 'completed' || task.status === 'cancelled') {
      throw new InvalidTransitionError(task.status, 'completeHumanTask');
    }

    // Auto-claim pending tasks so the actor is recorded on the task even
    // if they skipped the explicit claim step.
    let resolvedTask: HumanTask = task;
    if (task.status === 'pending') {
      resolvedTask = await this.humanTaskRepository.claim(taskId, actorId);
    }

    const effectiveActor = resolvedTask.assignedUserId ?? actorId;
    const now = new Date().toISOString();

    const { completionData, stepOutput, isL3Revise } = shapeCompletion(
      resolvedTask,
      payload,
      effectiveActor,
      now,
    );

    await this.humanTaskRepository.complete(taskId, completionData);

    const instance = await this.instanceRepository.getById(
      resolvedTask.processInstanceId,
    );
    if (!instance) {
      throw new Error(
        `Process instance '${resolvedTask.processInstanceId}' not found`,
      );
    }
    if (instance.status !== 'paused') {
      throw new InvalidTransitionError(instance.status, 'completeHumanTask');
    }

    await this.instanceRepository.update(resolvedTask.processInstanceId, {
      status: 'running',
      pauseReason: null,
      updatedAt: now,
    });

    if (!isL3Revise) {
      await this.advanceStep(resolvedTask.processInstanceId, stepOutput, {
        id: effectiveActor,
        role: 'human',
      });
    }

    const updatedTask = await this.humanTaskRepository.getById(taskId);
    const updatedInstance = await this.instanceRepository.getById(
      resolvedTask.processInstanceId,
    );

    return {
      task: updatedTask ?? resolvedTask,
      instance: updatedInstance ?? instance,
      stepOutput,
      resolvedStepId: resolvedTask.stepId,
      isL3Revise,
    };
  }

  private async loadInstance(instanceId: string): Promise<ProcessInstance> {
    const instance = await this.instanceRepository.getById(instanceId);
    if (!instance) {
      throw new Error(`Process instance '${instanceId}' not found`);
    }
    return instance;
  }

  /**
   * Build the previous-run-outputs snapshot for a new instance.
   *
   * Returns `null` when the workflow does not declare `inputForNextRun` (the
   * feature is off for this WD and `previousRun` should stay undefined).
   *
   * Returns `{ values, sourceId }` otherwise. `values` is `{}` when no
   * predecessor run qualifies (first run ever, all previous runs failed).
   * `sourceId` is only set when a predecessor was found.
   *
   * Two cases are deliberately distinguished:
   * - **Semantic empty** (first run, all predecessors failed, predecessor's
   *   step didn't produce the declared output): `values` is `{}` or partial
   *   and the run proceeds. Steps that read `previousRun` must handle this.
   * - **Infrastructure failure** (repository rejects, network error, etc.):
   *   the error propagates out of `createInstance`. A WD that declares
   *   `inputForNextRun` will not silently degrade to `{}` when resolution
   *   cannot be performed — the run is not created.
   */
  private async resolvePreviousRunOutputs(
    definition: WorkflowDefinition,
  ): Promise<{ values: Record<string, unknown>; sourceId?: string } | null> {
    if (!definition.inputForNextRun || definition.inputForNextRun.length === 0) {
      return null;
    }

    const predecessor = await this.instanceRepository.getLastCompletedByDefinitionName(
      definition.name,
    );
    if (!predecessor) {
      return { values: {} };
    }

    const values: Record<string, unknown> = {};
    for (const entry of definition.inputForNextRun) {
      // Review loops can run the same step multiple times; we carry the final
      // output from the latest execution.
      const latest = await this.instanceRepository.getLatestStepExecution(
        predecessor.id,
        entry.stepId,
      );
      const output = latest?.output;
      if (output !== null && typeof output === 'object' && entry.output in output) {
        values[entry.as] = (output as Record<string, unknown>)[entry.output];
      }
    }

    return { values, sourceId: predecessor.id };
  }

  /**
   * Load definition for an instance — always returns WorkflowDefinition.
   * Tries exact version match first, falls back to latest version by name.
   */
  private async loadDefinitionUnified(
    instance: ProcessInstance,
  ): Promise<WorkflowDefinition> {
    const ns = instance.namespace ?? '';
    const versionNum = parseInt(instance.definitionVersion, 10);
    if (!isNaN(versionNum)) {
      const wd = await this.processRepository.getWorkflowDefinition(
        ns,
        instance.definitionName,
        versionNum,
      );
      if (wd) return wd;
    }

    // Fallback: latest version by name (handles legacy instances with string versions like "1.0.0")
    const latestVersion = await this.processRepository.getLatestWorkflowVersion(ns, instance.definitionName);
    if (latestVersion > 0) {
      const wd = await this.processRepository.getWorkflowDefinition(ns, instance.definitionName, latestVersion);
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
