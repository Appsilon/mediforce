import {
  TriggerResourceSchema,
  type TriggerResource,
  type TriggerType,
} from '../schemas/trigger';
import type { TriggerRepository, TriggerUpdate } from '../interfaces/trigger-repository';

/**
 * In-memory {@link TriggerRepository} double for L2 parity + handler tests.
 *
 * Mirrors the Postgres backend's observable contract: PK uniqueness on
 * `create`, the partial webhook-path uniqueness constraint, and
 * `recordTriggered` as a cron-only cursor bump.
 */
export class InMemoryTriggerRepository implements TriggerRepository {
  private readonly store = new Map<string, TriggerResource>();

  private key(namespace: string, workflowName: string, name: string): string {
    return JSON.stringify([namespace, workflowName, name]);
  }

  private assertWebhookPathFree(candidate: TriggerResource): void {
    if (candidate.type !== 'webhook') return;
    for (const existing of this.store.values()) {
      if (existing.type !== 'webhook') continue;
      if (existing.namespace !== candidate.namespace) continue;
      if (existing.workflowName !== candidate.workflowName) continue;
      if (existing.name === candidate.name) continue;
      if (existing.config.path === candidate.config.path) {
        throw new Error(
          `webhook path '${candidate.config.path}' already used by trigger '${existing.name}'`,
        );
      }
    }
  }

  async listByWorkflow(namespace: string, workflowName: string): Promise<TriggerResource[]> {
    return [...this.store.values()].filter(
      (t) => t.namespace === namespace && t.workflowName === workflowName,
    );
  }

  async listEnabledByType(type: TriggerType): Promise<TriggerResource[]> {
    return [...this.store.values()].filter((t) => t.type === type && t.enabled === true);
  }

  async create(trigger: TriggerResource): Promise<TriggerResource> {
    const parsed = TriggerResourceSchema.parse(trigger);
    const key = this.key(parsed.namespace, parsed.workflowName, parsed.name);
    if (this.store.has(key)) {
      throw new Error(
        `trigger '${parsed.name}' already exists for ${parsed.namespace}/${parsed.workflowName}`,
      );
    }
    this.assertWebhookPathFree(parsed);
    this.store.set(key, parsed);
    return parsed;
  }

  async update(
    namespace: string,
    workflowName: string,
    name: string,
    patch: TriggerUpdate,
  ): Promise<TriggerResource> {
    const key = this.key(namespace, workflowName, name);
    const current = this.store.get(key);
    if (!current) {
      throw new Error(`trigger '${name}' not found for ${namespace}/${workflowName}`);
    }
    const next = TriggerResourceSchema.parse({
      ...current,
      ...(patch.enabled === undefined ? {} : { enabled: patch.enabled }),
      ...(patch.config === undefined ? {} : { config: patch.config }),
      updatedAt: patch.updatedAt,
    });
    this.assertWebhookPathFree(next);
    this.store.set(key, next);
    return next;
  }

  async recordTriggered(
    namespace: string,
    workflowName: string,
    name: string,
    triggeredAt: string,
  ): Promise<void> {
    const key = this.key(namespace, workflowName, name);
    const current = this.store.get(key);
    if (!current || current.type !== 'cron') return;
    this.store.set(key, { ...current, lastTriggeredAt: triggeredAt });
  }

  async delete(namespace: string, workflowName: string, name: string): Promise<void> {
    this.store.delete(this.key(namespace, workflowName, name));
  }

  async deleteByWorkflow(namespace: string, workflowName: string): Promise<void> {
    for (const [key, trigger] of this.store) {
      if (trigger.namespace === namespace && trigger.workflowName === workflowName) {
        this.store.delete(key);
      }
    }
  }
}
