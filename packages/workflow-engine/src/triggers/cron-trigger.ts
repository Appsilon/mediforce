import type { WorkflowEngine } from '../engine/workflow-engine.js';
import type { TriggerContext, TriggerResult } from './trigger-types.js';

export class CronTrigger {
  constructor(private readonly engine: WorkflowEngine) {}

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
