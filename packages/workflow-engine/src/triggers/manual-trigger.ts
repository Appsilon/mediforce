import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerResult, WorkflowTriggerContext } from './trigger-types.js';

/**
 * ManualTrigger: creates and starts a process instance via WorkflowEngine.
 *
 * Used for user-initiated flows where a human explicitly triggers
 * a new process execution.
 */
export class ManualTrigger {
  constructor(private readonly engine: WorkflowEngine) {}

  /**
   * Creates and starts a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   */
  async fireWorkflow(context: WorkflowTriggerContext): Promise<TriggerResult> {
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
