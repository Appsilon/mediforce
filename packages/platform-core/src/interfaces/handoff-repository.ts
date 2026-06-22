import type { HandoffEntity } from '../schemas/handoff-entity';

/**
 * Storage-layer authorization (ADR-0004): handoffs have no namespace field —
 * workspace is reached via the parent `ProcessInstance`. Implementations
 * resolve parent namespaces internally.
 */
export interface HandoffRepository {
  create(entity: HandoffEntity): Promise<HandoffEntity>;

  getById(entityId: string): Promise<HandoffEntity | null>;
  getByIdInNamespaces(entityId: string, allowed: readonly string[]): Promise<HandoffEntity | null>;

  getByRoleAll(role: string): Promise<HandoffEntity[]>; // created + acknowledged for role
  getByRoleInNamespaces(role: string, allowed: readonly string[]): Promise<HandoffEntity[]>;

  getByInstanceId(instanceId: string): Promise<HandoffEntity[]>;
  getByInstanceIdInNamespaces(instanceId: string, allowed: readonly string[]): Promise<HandoffEntity[]>;

  claim(entityId: string, userId: string): Promise<HandoffEntity>; // sets assignedUserId + status: 'acknowledged'
  acknowledge(entityId: string, userId: string): Promise<HandoffEntity>; // status: 'acknowledged'; userId must match assignedUserId
  resolve(entityId: string, userId: string, resolution: Record<string, unknown>): Promise<HandoffEntity>;
  // resolve: userId must === handoff.assignedUserId; validates resolution via handoffTypeRegistry
}
