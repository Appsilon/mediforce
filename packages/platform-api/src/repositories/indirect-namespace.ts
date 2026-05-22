import type { CallerIdentity } from '../auth.js';
import type { ProcessInstanceRepository } from '@mediforce/platform-core';

/** Batch-dedupe parent run lookups and filter entities by the parent's
 *  namespace. Indirect-namespace wrappers (HumanTask, Handoff, etc.) use this
 *  on list paths — at most one parent read per distinct run regardless of
 *  entity count. System-actor callers bypass (returned unchanged). */
export async function filterByParentNamespace<T extends { processInstanceId: string }>(
  entities: T[],
  caller: CallerIdentity,
  parents: ProcessInstanceRepository,
): Promise<T[]> {
  if (caller.isSystemActor) return entities;
  if (entities.length === 0) return [];
  const instanceIds = [...new Set(entities.map((e) => e.processInstanceId))];
  const namespaceById = new Map<string, string | undefined>();
  await Promise.all(
    instanceIds.map(async (id) => {
      const parent = await parents.getById(id);
      namespaceById.set(id, parent?.namespace);
    }),
  );
  return entities.filter((e) => {
    const ns = namespaceById.get(e.processInstanceId);
    return typeof ns === 'string' && caller.namespaces.has(ns);
  });
}
