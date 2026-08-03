import type { CallerScope } from '../../repositories/index';
import type {
  ListNamespaceAuditEventsInput,
  ListNamespaceAuditEventsOutput,
} from '../../contract/processes';

const DEFAULT_LIMIT = 20;

/**
 * Keyset-paginated audit events for a workspace (Monitoring → Users / Tasks
 * tabs), not scoped to a single run. Namespace gating lives in
 * AuthorizedAuditEventRepository.getByNamespace: an out-of-scope namespace
 * resolves to an empty list, not a 403 (ADR-0004 anti-enumeration).
 */
export async function listNamespaceAuditEvents(
  input: ListNamespaceAuditEventsInput,
  scope: CallerScope,
): Promise<ListNamespaceAuditEventsOutput> {
  const page = await scope.auditEvents.getByNamespace(input.namespace, {
    limit: input.limit ?? DEFAULT_LIMIT,
    cursor: input.cursor,
    actions: input.actions,
    actorId: input.actorId,
    fromDate: input.fromDate,
    toDate: input.toDate,
  });
  return { events: [...page.items], nextCursor: page.nextCursor };
}
