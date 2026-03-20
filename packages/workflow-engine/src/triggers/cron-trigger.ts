import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerResult, WorkflowTriggerContext } from './trigger-types.js';

export class CronTrigger {
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
      'cron',
      context.payload,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
