import type {
  CronTriggerState,
  CronTriggerStatePatch,
  CronTriggerStateRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped view of the Cron Trigger store (ADR-0010). Membership is on
 * the trigger's `namespace`. Reads outside the caller's namespaces return
 * null / empty (handler maps to 404); writes throw `ForbiddenError`.
 *
 * The heartbeat's cross-namespace reads (`listAllEnabled`, `recordTriggered`)
 * are deliberately absent — they run system-actor only via `scope.system.cron`.
 */
export class AuthorizedCronTriggerStateRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: CronTriggerStateRepository,
  ) {
    super(caller);
  }

  get = async (
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<CronTriggerState | null> => {
    if (!this.canSeeNamespace(namespace)) return null;
    return this.raw.get(namespace, definitionName, triggerName);
  };

  listByDefinition = async (
    namespace: string,
    definitionName: string,
  ): Promise<CronTriggerState[]> => {
    if (!this.canSeeNamespace(namespace)) return [];
    return this.raw.listByDefinition(namespace, definitionName);
  };

  create = async (trigger: CronTriggerState): Promise<void> => {
    this.assertNamespaceWrite(trigger.namespace);
    await this.raw.create(trigger);
  };

  update = async (
    namespace: string,
    definitionName: string,
    triggerName: string,
    patch: CronTriggerStatePatch,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.update(namespace, definitionName, triggerName, patch);
  };

  delete = async (
    namespace: string,
    definitionName: string,
    triggerName: string,
  ): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.delete(namespace, definitionName, triggerName);
  };

  deleteByDefinition = async (namespace: string, definitionName: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    await this.raw.deleteByDefinition(namespace, definitionName);
  };
}
