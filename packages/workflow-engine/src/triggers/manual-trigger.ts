import type { ProcessRepository, TriggerRepository } from '@mediforce/platform-core';
import type { WorkflowEngine } from '../engine/workflow-engine';
import type { TriggerResult, WorkflowTriggerContext } from './trigger-types';
import { ManualTriggerNotDeclaredError } from './trigger-errors';

/**
 * ManualTrigger: creates and starts a process instance via WorkflowEngine.
 *
 * Used for user-initiated flows where a human explicitly triggers
 * a new process execution.
 *
 * Gates on an **enabled `manual` trigger row** in the unified triggers table
 * (ADR-0011) keyed by `(namespace, workflowName)` — not on the definition's
 * advisory `triggers[]`. This is the server-side counterpart to the disabled
 * state of the StartRunButton: workflows without an enabled manual trigger
 * cannot be started by callers that bypass the UI gate.
 */
export class ManualTrigger {
  constructor(
    private readonly engine: WorkflowEngine,
    private readonly processRepository: ProcessRepository,
    private readonly triggerRepository: TriggerRepository,
  ) {}

  /**
   * Creates and starts a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   *
   * Throws {@link ManualTriggerNotDeclaredError} when the workflow has no
   * enabled `manual` trigger row. The engine error for "definition not found"
   * propagates unchanged.
   */
  async fireWorkflow(context: WorkflowTriggerContext): Promise<TriggerResult> {
    const definition = await this.processRepository.getWorkflowDefinition(
      context.namespace,
      context.definitionName,
      context.definitionVersion,
    );
    if (!definition) {
      throw new Error(
        `Workflow definition '${context.definitionName}' version '${context.definitionVersion}' not found`,
      );
    }
    const triggers = await this.triggerRepository.listByWorkflow(
      context.namespace,
      context.definitionName,
    );
    const hasEnabledManualTrigger = triggers.some(
      (trigger) => trigger.type === 'manual' && trigger.enabled,
    );
    if (!hasEnabledManualTrigger) {
      throw new ManualTriggerNotDeclaredError(
        context.definitionName,
        context.definitionVersion,
      );
    }

    const instance = await this.engine.createInstance(
      context.namespace,
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'manual',
      context.payload,
      { parentInstanceId: context.parentInstanceId, parentDefinitionName: context.parentDefinitionName, dryRun: context.dryRun },
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
