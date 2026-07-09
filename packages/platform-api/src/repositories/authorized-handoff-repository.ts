import type {
  HandoffEntity,
  HandoffRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { ForbiddenError } from '../errors';
import { AuthorizedScope } from './authorized-repository';

/**
 * Workspace-scoped handoff entity reads + mutations. Handoffs have no
 * workspace field; namespace is reached via the parent `ProcessInstance`,
 * resolved inside the raw repo. Wrapper routes between unscoped and
 * namespace-scoped variants by `caller.isSystemActor`.
 *
 * `resolve` and `acknowledge` enforce workspace via `assertCanMutate`; the
 * remaining business invariants (`userId === assignedUserId`, resolution
 * validation) live in the underlying repo and the handler.
 */
export class AuthorizedHandoffRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: HandoffRepository,
  ) {
    super(caller);
  }

  getById = async (entityId: string): Promise<HandoffEntity | null> =>
    this.caller.isSystemActor
      ? this.raw.getById(entityId)
      : this.raw.getByIdInNamespaces(entityId, [...this.caller.namespaces]);

  getByRole = async (role: string): Promise<HandoffEntity[]> =>
    this.caller.isSystemActor
      ? this.raw.getByRoleAll(role)
      : this.raw.getByRoleInNamespaces(role, [...this.caller.namespaces]);

  getByInstanceId = async (instanceId: string): Promise<HandoffEntity[]> =>
    this.caller.isSystemActor
      ? this.raw.getByInstanceId(instanceId)
      : this.raw.getByInstanceIdInNamespaces(instanceId, [...this.caller.namespaces]);

  claim = async (entityId: string, userId: string): Promise<HandoffEntity> => {
    await this.assertCanMutate(entityId);
    return this.raw.claim(entityId, userId);
  };

  acknowledge = async (entityId: string, userId: string): Promise<HandoffEntity> => {
    await this.assertCanMutate(entityId);
    return this.raw.acknowledge(entityId, userId);
  };

  resolve = async (
    entityId: string,
    userId: string,
    resolution: Record<string, unknown>,
  ): Promise<HandoffEntity> => {
    await this.assertCanMutate(entityId);
    return this.raw.resolve(entityId, userId, resolution);
  };

  private async assertCanMutate(entityId: string): Promise<void> {
    const entity = await this.getById(entityId);
    if (entity === null) throw new ForbiddenError();
  }
}
