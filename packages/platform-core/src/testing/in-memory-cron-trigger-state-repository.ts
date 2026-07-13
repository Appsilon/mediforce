import {
  CronTriggerStateSchema,
  type CronTriggerState,
  type CronTriggerStatePatch,
} from '../schemas/cron-trigger-state';
import type { CronTriggerStateRepository } from '../interfaces/cron-trigger-state-repository';

export class InMemoryCronTriggerStateRepository implements CronTriggerStateRepository {
  private readonly store = new Map<string, CronTriggerState>();

  private key(namespace: string, definitionName: string, triggerName: string): string {
    return `${namespace}:${definitionName}:${triggerName}`;
  }

  async get(
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<CronTriggerState | null> {
    return this.store.get(this.key(namespace, definitionName, triggerName)) ?? null;
  }

  async listByDefinition(
    namespace: string,
    definitionName: string,
  ): Promise<CronTriggerState[]> {
    return [...this.store.values()].filter(
      (row) => row.namespace === namespace && row.definitionName === definitionName,
    );
  }

  async listAllEnabled(): Promise<CronTriggerState[]> {
    return [...this.store.values()].filter((row) => row.enabled);
  }

  async create(trigger: CronTriggerState): Promise<void> {
    const parsed = CronTriggerStateSchema.parse(trigger);
    this.store.set(
      this.key(parsed.namespace, parsed.definitionName, parsed.triggerName),
      parsed,
    );
  }

  async update(
    namespace: string,
    definitionName: string,
    triggerName: string,
    patch: CronTriggerStatePatch,
  ): Promise<void> {
    const key = this.key(namespace, definitionName, triggerName);
    const existing = this.store.get(key);
    if (!existing) return;
    this.store.set(key, CronTriggerStateSchema.parse({ ...existing, ...patch }));
  }

  async recordTriggered(
    namespace: string,
    definitionName: string,
    triggerName: string,
    at: string,
  ): Promise<void> {
    const key = this.key(namespace, definitionName, triggerName);
    const existing = this.store.get(key);
    if (!existing) return;
    this.store.set(key, CronTriggerStateSchema.parse({ ...existing, lastTriggeredAt: at }));
  }

  async delete(
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<void> {
    this.store.delete(this.key(namespace, definitionName, triggerName));
  }

  async deleteByDefinition(namespace: string, definitionName: string): Promise<void> {
    for (const [key, row] of this.store) {
      if (row.namespace === namespace && row.definitionName === definitionName) {
        this.store.delete(key);
      }
    }
  }
}
