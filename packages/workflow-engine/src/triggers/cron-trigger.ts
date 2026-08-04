import type { WorkflowEngine } from '../engine/workflow-engine';
import type { TriggerResult, WorkflowFiring } from './trigger-types';

export class CronTrigger {
  constructor(private readonly engine: WorkflowEngine) {}

  /**
   * Creates and starts a workflow instance from a unified WorkflowDefinition.
   * No separate ProcessConfig required — all config is embedded in the definition.
   *
   * `payload` is the trigger row's static input, already validated against the
   * resolved definition's `triggerInput` by the heartbeat (a drift skips the
   * tick rather than firing an invalid Run). The tick's `schedule`/`firedAt`
   * ride on `context`, not the payload — they are transport, not input.
   */
  async fireWorkflow(firing: WorkflowFiring): Promise<TriggerResult> {
    const instance = await this.engine.createInstance(
      firing.namespace,
      firing.definitionName,
      firing.definitionVersion,
      firing.triggeredBy,
      'cron',
      firing.payload,
      firing.context === undefined ? undefined : { triggerContext: firing.context },
    );

    await this.engine.startInstance(instance.id);

    return { instanceId: instance.id, status: 'created' };
  }
}
