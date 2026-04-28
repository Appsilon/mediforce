import type { CronTriggerState } from '../schemas/cron-trigger-state.js';
import type { CronTriggerStateRepository } from '../interfaces/cron-trigger-state-repository.js';

export class InMemoryCronTriggerStateRepository implements CronTriggerStateRepository {
  private readonly store = new Map<string, CronTriggerState>();

  private key(definitionName: string, triggerName: string): string {
    return `${definitionName}:${triggerName}`;
  }

  async get(definitionName: string, triggerName: string): Promise<CronTriggerState | null> {
    return this.store.get(this.key(definitionName, triggerName)) ?? null;
  }

  async set(state: CronTriggerState): Promise<void> {
    this.store.set(this.key(state.definitionName, state.triggerName), state);
  }
}
