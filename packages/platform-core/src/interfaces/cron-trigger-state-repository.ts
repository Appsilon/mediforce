import type { CronTriggerState } from '../schemas/cron-trigger-state';

export interface CronTriggerStateRepository {
  get(definitionName: string, triggerName: string): Promise<CronTriggerState | null>;
  set(state: CronTriggerState): Promise<void>;
}
