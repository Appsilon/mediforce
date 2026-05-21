import type {
  HandoffEntity,
  HandoffRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped handoff entity reads + mutations. Handoffs have no
 * workspace field; namespace is reached via the parent `ProcessInstance`.
 *
 * `resolve` and `acknowledge` enforce workspace at the wrapper layer; the
 * remaining business invariants (`userId === assignedUserId`, resolution
 * validation) live in the underlying repo and the handler.
 */
export interface AuthorizedHandoffRepository {
  getById(entityId: string): Promise<HandoffEntity | null>;
  getByRole(role: string): Promise<HandoffEntity[]>;
  getByInstanceId(instanceId: string): Promise<HandoffEntity[]>;
  claim(entityId: string, userId: string): Promise<HandoffEntity>;
  acknowledge(entityId: string, userId: string): Promise<HandoffEntity>;
  resolve(
    entityId: string,
    userId: string,
    resolution: Record<string, unknown>,
  ): Promise<HandoffEntity>;
}

export class AuthorizedHandoffRepositoryImpl
  extends AuthorizedRepository<HandoffEntity>
  implements AuthorizedHandoffRepository
{
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
    if (this.caller.kind === 'apiKey') return entity;
    const parent = await this.parents.getById(entity.processInstanceId);
    return this.canSeeNamespace(parent?.namespace) ? entity : null;
  };

  getByRole = async (role: string): Promise<HandoffEntity[]> => {
    const entities = await this.raw.getByRole(role);
    return this.filterByParents(entities);
  };

  getByInstanceId = async (instanceId: string): Promise<HandoffEntity[]> => {
    if (this.caller.kind === 'apiKey') return this.raw.getByInstanceId(instanceId);
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

  private async filterByParents(entities: HandoffEntity[]): Promise<HandoffEntity[]> {
    if (this.caller.kind === 'apiKey') return entities;
    if (entities.length === 0) return [];
    const instanceIds = [...new Set(entities.map((e) => e.processInstanceId))];
    const namespaceById = new Map<string, string | undefined>();
    await Promise.all(
      instanceIds.map(async (id) => {
        const parent = await this.parents.getById(id);
        namespaceById.set(id, parent?.namespace);
      }),
    );
    return entities.filter((e) => this.canSeeNamespace(namespaceById.get(e.processInstanceId)));
  }
}
