import type {
  TriggerRepository,
  TriggerResource,
  TriggerType,
  TriggerUpdate,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped access to the unified `triggers` table (ADR-0011 /
 * ADR-0004). Each row carries its own `namespace`, so gating is a direct
 * `canSeeNamespace(row.namespace)` predicate — no parent lookup.
 *
 * `listEnabledByType` is the one cross-namespace read (the cron heartbeat's
 * `type='cron'` sweep); through this wrapper it is filtered to the caller's
 * namespaces. The heartbeat itself runs as a system actor and reaches the
 * unwrapped repo via `scope.system.triggers`.
 */
export class AuthorizedTriggerRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: TriggerRepository,
  ) {
    super(caller);
  }

  listByWorkflow = async (namespace: string, workflowName: string): Promise<TriggerResource[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.listByWorkflow(namespace, workflowName);
  };

  listEnabledByType = async (type: TriggerType): Promise<TriggerResource[]> => {
    const rows = await this.raw.listEnabledByType(type);
    return rows.filter((row) => this.canSeeNamespace(row.namespace));
  };

  create = async (trigger: TriggerResource): Promise<TriggerResource> => {
    this.assertNamespaceWrite(trigger.namespace);
    return this.raw.create(trigger);
  };

  update = async (
    namespace: string,
    workflowName: string,
    name: string,
    patch: TriggerUpdate,
  ): Promise<TriggerResource> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.update(namespace, workflowName, name, patch);
  };

  recordTriggered = async (
    namespace: string,
    workflowName: string,
    name: string,
    triggeredAt: string,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.recordTriggered(namespace, workflowName, name, triggeredAt);
  };

  delete = async (namespace: string, workflowName: string, name: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.delete(namespace, workflowName, name);
  };

  deleteByWorkflow = async (namespace: string, workflowName: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    return this.raw.deleteByWorkflow(namespace, workflowName);
  };
}
