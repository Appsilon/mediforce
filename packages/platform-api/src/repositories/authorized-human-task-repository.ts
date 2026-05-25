import type {
  HumanTask,
  HumanTaskRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped view of `HumanTaskRepository`. Tasks have no namespace
 * field of their own — workspace membership is reached via the parent
 * `ProcessInstance`, which the raw repo resolves internally. Wrapper picks
 * between system-actor and namespace-scoped variants per call.
 */
export class AuthorizedHumanTaskRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: HumanTaskRepository,
  ) {
    super(caller);
  }

  getById = async (taskId: string): Promise<HumanTask | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(taskId)
      : this.raw.getByIdInNamespaces(taskId, [...this.caller.namespaces]);

  getByRole = async (role: string): Promise<HumanTask[]> =>
    this.caller.isSystemActor
      ? this.raw.getByRoleAll(role)
      : this.raw.getByRoleInNamespaces(role, [...this.caller.namespaces]);

  getByInstanceId = async (instanceId: string): Promise<HumanTask[]> =>
    this.caller.isSystemActor
      ? this.raw.getByInstanceId(instanceId)
      : this.raw.getByInstanceIdInNamespaces(instanceId, [...this.caller.namespaces]);

  claim = async (taskId: string, userId: string): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.claim(taskId, userId);
  };

  complete = async (taskId: string, completionData: Record<string, unknown>): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.complete(taskId, completionData);
  };

  cancel = async (taskId: string): Promise<HumanTask> => {
    await this.assertCanMutate(taskId);
    return this.raw.cancel(taskId);
  };

  private async assertCanMutate(taskId: string): Promise<void> {
    const task = await this.getById(taskId);
    if (task === null) throw new ForbiddenError();
  }
}
