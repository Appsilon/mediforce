import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerContext, TriggerResult, WorkflowTriggerContext } from './trigger-types.js';

export class CronTrigger {
  constructor(private readonly engine: WorkflowEngine) {}

  /**
   * Creates and starts a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   */
  async fireWorkflow(context: WorkflowTriggerContext): Promise<TriggerResult> {
    const instance = await this.engine.createWorkflowInstance(
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'cron',
      context.payload,
      context.roles,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }

  /** @deprecated Use fireWorkflow instead */
  async fire(context: TriggerContext): Promise<TriggerResult> {
    const instance = await this.engine.createInstance(
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'cron',
      context.payload,
      context.configName,
      context.configVersion,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
