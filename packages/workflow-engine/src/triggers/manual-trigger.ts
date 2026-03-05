import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerContext, TriggerResult } from './trigger-types.js';

/**
 * ManualTrigger: creates and starts a process instance via WorkflowEngine.
 *
 * Used for user-initiated flows where a human explicitly triggers
 * a new process execution.
 */
export class ManualTrigger {
  constructor(private readonly engine: WorkflowEngine) {}

  async fire(context: TriggerContext): Promise<TriggerResult> {
    const instance = await this.engine.createInstance(
      context.definitionName,
      context.definitionVersion,
      context.triggeredBy,
      'manual',
      context.payload,
      context.configName,
      context.configVersion,
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
