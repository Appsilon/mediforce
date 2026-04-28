import type { ProcessRepository } from '@mediforce/platform-core';
import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerResult, WorkflowTriggerContext } from './trigger-types.js';
import { ManualTriggerNotDeclaredError } from './trigger-errors.js';

/**
 * ManualTrigger: creates and starts a process instance via WorkflowEngine.
 *
 * Used for user-initiated flows where a human explicitly triggers
 * a new process execution.
 *
 * Validates that the target WorkflowDefinition declares a `manual` trigger
 * before creating the instance. This is the server-side counterpart to the
 * disabled state of the StartRunButton — it ensures that workflows without
 * a manual trigger cannot be started by callers that bypass the UI gate.
 */
export class ManualTrigger {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly processRepository: ProcessRepository,
  ) {}

  /**
   * Creates and starts a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   *
   * Throws {@link ManualTriggerNotDeclaredError} when the WD does not declare
   * a `manual` trigger. The engine error for "definition not found" propagates
   * unchanged.
   */
  async fireWorkflow(context: WorkflowTriggerContext): Promise<TriggerResult> {
    const definition = await this.processRepository.getWorkflowDefinition(
      context.definitionName,
      context.definitionVersion,
    );
    if (!definition) {
      throw new Error(
        `Workflow definition '${context.definitionName}' version '${context.definitionVersion}' not found`,
      );
    }
    const hasManualTrigger = definition.triggers.some(
      (trigger) => trigger.type === 'manual',
    );
    if (!hasManualTrigger) {
      throw new ManualTriggerNotDeclaredError(
        context.definitionName,
        context.definitionVersion,
      );
    }

    const instance = await this.engine.createInstance(
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'manual',
      context.payload,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
