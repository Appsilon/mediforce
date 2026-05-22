import type {
  HandoffEntity,
  HandoffRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedScope } from './authorized-repository.js';
import { filterByParentNamespace } from './indirect-namespace.js';

/**
 * Workspace-scoped handoff entity reads + mutations. Handoffs have no
 * workspace field; namespace is reached via the parent `ProcessInstance`.
 *
 * `resolve` and `acknowledge` enforce workspace at the wrapper layer; the
 * remaining business invariants (`userId === assignedUserId`, resolution
 * validation) live in the underlying repo and the handler.
 */
export class AuthorizedHandoffRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: HandoffRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getById = async (entityId: string): Promise<HandoffEntity | null> => {
    const entity = await this.raw.getById(entityId);
    if (entity === null) return null;
    if (this.caller.isSystemActor) return entity;
    const parent = await this.parents.getById(entity.processInstanceId);
    return this.canSeeNamespace(parent?.namespace) ? entity : null;
  };

  getByRole = async (role: string): Promise<HandoffEntity[]> => {
    const entities = await this.raw.getByRole(role);
    return filterByParentNamespace(entities, this.caller, this.parents);
  };

  getByInstanceId = async (instanceId: string): Promise<HandoffEntity[]> => {
    const parent = await this.parents.getById(instanceId);
    if (!this.canSeeNamespace(parent?.namespace)) return [];
    return this.raw.getByInstanceId(instanceId);
  };

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
