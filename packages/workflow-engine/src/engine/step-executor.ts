import type {
  ProcessInstanceRepository,
  AuditRepository,
  ProcessInstance,
  ProcessDefinition,
  ReviewVerdict,
} from '@mediforce/platform-core';
import {
  resolveTransitions,
  TransitionValidationError,
  NoMatchingTransitionError,
} from './transition-resolver.js';
import { RoutingError, InvalidTransitionError } from './errors.js';

export interface StepActor {
  id: string;
  role: string;
}

/**
 * StepExecutor: execute a single step, resolve routing, emit audit event, update instance state.
 *
 * Routing priority:
 *  1. Review steps with verdicts → native verdict routing (step.verdicts[v].target)
 *  2. All other steps → when-expression evaluation on outgoing transitions
 */
export class StepExecutor {
  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
    private readonly auditRepository: AuditRepository,
  ) {}

  async executeStep(
    instance: ProcessInstance,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    definition: ProcessDefinition,
    reviewVerdicts?: ReviewVerdict[],
  ): Promise<void> {
    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'executeStep');
    }

    const currentStepId = instance.currentStepId!;
    const currentStep = definition.steps.find((s) => s.id === currentStepId);
    if (!currentStep) {
      throw new Error(`Step '${currentStepId}' not found in definition`);
    }

    let nextStepId: string;
    let routingResult: { next: string; reason: string } | null = null;

    // --- Route: native verdict routing for review steps ---
    if (
      currentStep.type === 'review' &&
      currentStep.verdicts &&
      typeof stepOutput.verdict === 'string'
    ) {
      const verdictKey = stepOutput.verdict;
      const verdictConfig = currentStep.verdicts[verdictKey];
      if (!verdictConfig) {
        const error = new RoutingError(
          currentStepId,
          `Unknown verdict '${verdictKey}' on review step '${currentStepId}'`,
        );
        await this.pauseOnRoutingError(
          instance, currentStepId, stepOutput, actor, definition.version, error,
        );
        throw error;
      }
      nextStepId = verdictConfig.target;
      routingResult = { next: nextStepId, reason: `Verdict: ${verdictKey}` };
    } else {
      // --- Route: when-expression evaluation ---
      const outgoing = definition.transitions.filter(
        (t) => t.from === currentStepId,
      );

      try {
        const resolved = resolveTransitions(outgoing, {
          output: stepOutput,
          variables: instance.variables,
          verdict:
            typeof stepOutput.verdict === 'string'
              ? stepOutput.verdict
              : undefined,
        });

        if (resolved.length > 1) {
          throw new RoutingError(
            currentStepId,
            `Multiple transitions matched from '${currentStepId}' ` +
              `(parallel not yet supported): ${resolved.map((r) => r.to).join(', ')}`,
          );
        }

        nextStepId = resolved[0].to;
        routingResult = { next: nextStepId, reason: resolved[0].reason };
      } catch (err) {
        if (err instanceof RoutingError) {
          await this.pauseOnRoutingError(
            instance, currentStepId, stepOutput, actor, definition.version, err,
          );
          throw err;
        }
        if (
          err instanceof TransitionValidationError ||
          err instanceof NoMatchingTransitionError
        ) {
          const routingError = new RoutingError(currentStepId, err.message);
          await this.pauseOnRoutingError(
            instance, currentStepId, stepOutput, actor,
            definition.version, routingError,
          );
          throw routingError;
        }
        throw err;
      }
    }

    // Validate next step exists in definition
    const nextStep = definition.steps.find((s) => s.id === nextStepId);
    if (!nextStep) {
      const error = new RoutingError(
        currentStepId,
        `Routing returned invalid step '${nextStepId}'`,
      );
      await this.pauseOnRoutingError(
        instance, currentStepId, stepOutput, actor, definition.version, error,
      );
      throw error;
    }

    const isTerminal = nextStep.type === 'terminal';

    if (isTerminal) {
      await this.instanceRepository.update(instance.id, {
        status: 'completed',
        currentStepId: null,
        variables: { ...instance.variables, [currentStepId]: stepOutput },
        updatedAt: new Date().toISOString(),
      });
    } else {
      await this.instanceRepository.update(instance.id, {
        currentStepId: nextStepId,
        variables: { ...instance.variables, [currentStepId]: stepOutput },
        updatedAt: new Date().toISOString(),
      });
    }

    // Compute semantic input: previous step's output from instance variables
    const incomingTransition = definition.transitions.find(
      (t) => t.to === currentStepId,
    );
    const previousStepId = incomingTransition?.from ?? null;
    const stepInput = previousStepId
      ? (instance.variables[previousStepId] as Record<string, unknown>) ?? {}
      : {};

    await this.recordStepExecution(
      instance, currentStepId, 'completed', stepInput, stepOutput,
      actor, definition.version, routingResult, null,
    );

    await this.emitAuditEvent(
      'step.completed',
      actor, instance, currentStepId, definition.version,
      { stepId: currentStepId, input: stepOutput },
      routingResult ?? {},
      routingResult?.reason ?? 'direct transition',
    );
  }

  async failStep(
    instance: ProcessInstance,
    stepId: string,
    error: Error,
    actor: StepActor,
  ): Promise<void> {
    await this.instanceRepository.update(instance.id, {
      status: 'paused',
      pauseReason: 'step_failure',
      updatedAt: new Date().toISOString(),
    });

    await this.recordStepExecution(
      instance, stepId, 'failed', {}, {},
      actor, instance.definitionVersion, null, error.message,
    );

    await this.emitAuditEvent(
      'step.failed',
      actor, instance, stepId, instance.definitionVersion,
      { stepId, error: error.message },
      {},
      `Step failure: ${error.message}`,
    );
  }

  private async pauseOnRoutingError(
    instance: ProcessInstance,
    stepId: string,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    version: string,
    error: RoutingError,
  ): Promise<void> {
    await this.instanceRepository.update(instance.id, {
      status: 'paused',
      pauseReason: 'routing_error',
      updatedAt: new Date().toISOString(),
    });

    await this.recordStepExecution(
      instance, stepId, 'failed', {}, stepOutput,
      actor, version, null, error.message,
    );

    await this.emitAuditEvent(
      'routing.error',
      actor, instance, stepId, version,
      { stepId, input: stepOutput },
      { error: error.message },
      `Routing error: ${error.message}`,
    );
  }

  private async recordStepExecution(
    instance: ProcessInstance,
    stepId: string,
    status: 'completed' | 'failed',
    stepInput: Record<string, unknown>,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    definitionVersion: string,
    gateResult: { next: string; reason: string } | null,
    error: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    const verdict = typeof stepOutput.verdict === 'string' ? stepOutput.verdict : null;

    // Merge into existing execution if one exists (e.g. auto-runner already
    // created a 'running' record before the agent ran). This prevents
    // duplicate rows in the step history.
    const allExecs = await this.instanceRepository.getStepExecutions(instance.id);
    const existing = allExecs
      .filter((e) => e.stepId === stepId)
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())[0] ?? null;

    if (existing) {
      const outputAlreadySet = existing.output !== null && existing.output !== undefined;
      await this.instanceRepository.updateStepExecution(
        instance.id,
        existing.id,
        {
          status,
          output: outputAlreadySet ? existing.output : (status === 'completed' ? stepOutput : null),
          verdict,
          completedAt: now,
          gateResult,
          error,
        },
      );
      return;
    }

    await this.instanceRepository.addStepExecution(instance.id, {
      id: crypto.randomUUID(),
      instanceId: instance.id,
      stepId,
      status,
      input: stepInput,
      output: status === 'completed' ? stepOutput : null,
      verdict,
      executedBy: actor.id,
      startedAt: now,
      completedAt: now,
      iterationNumber: 0,
      gateResult,
      error,
    });
  }

  private async emitAuditEvent(
    action: string,
    actor: StepActor,
    instance: ProcessInstance,
    stepId: string,
    definitionVersion: string,
    inputSnapshot: Record<string, unknown>,
    outputSnapshot: Record<string, unknown>,
    basis: string,
  ): Promise<void> {
    await this.auditRepository.append({
      actorId: actor.id,
      actorType: 'user',
      actorRole: actor.role,
      action,
      description: `${action} on step '${stepId}' of instance '${instance.id}'`,
      timestamp: new Date().toISOString(),
      inputSnapshot,
      outputSnapshot,
      basis,
      entityType: 'processInstance',
      entityId: instance.id,
      processInstanceId: instance.id,
      stepId,
      processDefinitionVersion: definitionVersion,
    });
  }
}
