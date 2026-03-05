import type {
  ProcessInstanceRepository,
  AuditRepository,
  ProcessInstance,
  ProcessDefinition,
  ReviewVerdict,
} from '@mediforce/platform-core';
import {
  GateNotFoundError,
  GateExecutionError,
  type GateRegistry,
} from '../gates/gate-registry.js';
import { GateError, InvalidTransitionError } from './errors.js';

export interface StepActor {
  id: string;
  role: string;
}

/**
 * StepExecutor: execute a single step, invoke gate, emit audit event, update instance state.
 * Handles both normal transitions and gate-driven routing.
 */
export class StepExecutor {
  constructor(
    private readonly instanceRepository: ProcessInstanceRepository,
    private readonly auditRepository: AuditRepository,
    private readonly gateRegistry: GateRegistry,
  ) {}

  async executeStep(
    instance: ProcessInstance,
    stepOutput: Record<string, unknown>,
    actor: StepActor,
    definition: ProcessDefinition,
    reviewVerdicts?: ReviewVerdict[],
  ): Promise<void> {
    // Validate instance is running
    if (instance.status !== 'running') {
      throw new InvalidTransitionError(instance.status, 'executeStep');
    }

    const currentStepId = instance.currentStepId!;
    const currentStep = definition.steps.find((s) => s.id === currentStepId);
    if (!currentStep) {
      throw new Error(`Step '${currentStepId}' not found in definition`);
    }

    // Find outgoing transition(s) from current step
    const transitions = definition.transitions.filter(
      (t) => t.from === currentStepId,
    );

    // Determine the gate name (all transitions from a step with a gate share the same gate)
    const gatedTransition = transitions.find((t) => t.gate);
    const gateName = gatedTransition?.gate;

    let nextStepId: string;
    let gateResult: { next: string; reason: string } | null = null;

    if (gateName) {
      // Invoke gate
      try {
        gateResult = this.gateRegistry.invoke(gateName, {
          stepId: currentStepId,
          stepOutput,
          processVariables: instance.variables,
          reviewVerdicts,
        });
      } catch (err) {
        // Handle gate errors -- pause instance and emit audit
        const gateError =
          err instanceof GateNotFoundError
            ? new GateError(gateName, (err as Error).message)
            : err instanceof GateExecutionError
              ? new GateError(
                  (err as GateExecutionError).gateName,
                  (err as Error).message,
                )
              : new GateError(gateName, (err as Error).message);

        await this.instanceRepository.update(instance.id, {
          status: 'paused',
          pauseReason: 'gate_error',
          updatedAt: new Date().toISOString(),
        });

        await this.recordStepExecution(
          instance,
          currentStepId,
          'failed',
          stepOutput,
          actor,
          definition.version,
          null,
          gateError.message,
        );

        await this.emitAuditEvent(
          'gate.error',
          actor,
          instance,
          currentStepId,
          definition.version,
          { stepId: currentStepId, input: stepOutput },
          { error: gateError.message, gateName },
          `Gate error: ${gateError.message}`,
        );

        throw gateError;
      }

      // Validate gate result next step exists in definition
      if (
        gateResult.next !== '' &&
        !definition.steps.find((s) => s.id === gateResult!.next)
      ) {
        const gateError = new GateError(
          gateName,
          `Gate returned invalid nextStepId '${gateResult.next}'`,
        );

        await this.instanceRepository.update(instance.id, {
          status: 'paused',
          pauseReason: 'gate_error',
          updatedAt: new Date().toISOString(),
        });

        await this.recordStepExecution(
          instance,
          currentStepId,
          'failed',
          stepOutput,
          actor,
          definition.version,
          null,
          gateError.message,
        );

        await this.emitAuditEvent(
          'gate.error',
          actor,
          instance,
          currentStepId,
          definition.version,
          { stepId: currentStepId, input: stepOutput },
          { error: gateError.message, gateName },
          `Gate error: ${gateError.message}`,
        );

        throw gateError;
      }

      // Use gate result or fall back to transition's to field
      nextStepId =
        gateResult.next !== '' ? gateResult.next : transitions[0].to;
    } else {
      // No gate, use direct transition
      if (transitions.length === 0) {
        throw new Error(
          `No outgoing transition from step '${currentStepId}'`,
        );
      }
      nextStepId = transitions[0].to;
    }

    // Check if next step is terminal
    const nextStep = definition.steps.find((s) => s.id === nextStepId);
    const isTerminal = nextStep?.type === 'terminal';

    if (isTerminal) {
      // Complete the instance
      await this.instanceRepository.update(instance.id, {
        status: 'completed',
        currentStepId: null,
        variables: {
          ...instance.variables,
          [currentStepId]: stepOutput,
        },
        updatedAt: new Date().toISOString(),
      });
    } else {
      // Move to next step
      await this.instanceRepository.update(instance.id, {
        currentStepId: nextStepId,
        variables: {
          ...instance.variables,
          [currentStepId]: stepOutput,
        },
        updatedAt: new Date().toISOString(),
      });
    }

    // Record step execution
    await this.recordStepExecution(
      instance,
      currentStepId,
      'completed',
      stepOutput,
      actor,
      definition.version,
      gateResult,
      null,
    );

    // Emit audit event
    await this.emitAuditEvent(
      'step.completed',
      actor,
      instance,
      currentStepId,
      definition.version,
      { stepId: currentStepId, input: stepOutput },
      gateResult ?? {},
      gateResult?.reason ?? 'direct transition',
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
      instance,
      stepId,
      'failed',
      {},
      actor,
      instance.definitionVersion,
      null,
      error.message,
    );

    await this.emitAuditEvent(
      'step.failed',
      actor,
      instance,
      stepId,
      instance.definitionVersion,
      { stepId, error: error.message },
      {},
      `Step failure: ${error.message}`,
    );
  }

  private async recordStepExecution(
    instance: ProcessInstance,
    stepId: string,
    status: 'completed' | 'failed',
    input: Record<string, unknown>,
    actor: StepActor,
    definitionVersion: string,
    gateResult: { next: string; reason: string } | null,
    error: string | null,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.instanceRepository.addStepExecution(instance.id, {
      id: crypto.randomUUID(),
      instanceId: instance.id,
      stepId,
      status,
      input,
      output: status === 'completed' ? input : null,
      verdict: typeof input.verdict === 'string' ? input.verdict : null,
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
