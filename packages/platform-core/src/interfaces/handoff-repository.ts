import type { HandoffEntity } from '../schemas/handoff-entity.js';

export interface HandoffRepository {
  create(entity: HandoffEntity): Promise<HandoffEntity>;
  getById(entityId: string): Promise<HandoffEntity | null>;
  getByRole(role: string): Promise<HandoffEntity[]>;           // created + acknowledged for role
  getByInstanceId(instanceId: string): Promise<HandoffEntity[]>;
  claim(entityId: string, userId: string): Promise<HandoffEntity>;     // sets assignedUserId + status: 'acknowledged'
  acknowledge(entityId: string, userId: string): Promise<HandoffEntity>; // status: 'acknowledged'; userId must match assignedUserId
  resolve(entityId: string, userId: string, resolution: Record<string, unknown>): Promise<HandoffEntity>;
  // resolve: userId must === handoff.assignedUserId; validates resolution via handoffTypeRegistry
}
