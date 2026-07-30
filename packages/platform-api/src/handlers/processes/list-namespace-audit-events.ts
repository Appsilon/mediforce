import type { CallerScope } from '../../repositories/index';
import type {
  ListNamespaceAuditEventsInput,
  ListNamespaceAuditEventsOutput,
} from '../../contract/processes';

/**
 * Every audit event for a workspace (Monitoring → Users tab), not scoped to
 * a single run — powers the platform-wide user-activity table. Namespace
 * gating lives in AuthorizedAuditEventRepository.getByNamespace: an
 * out-of-scope namespace resolves to an empty list, not a 403 (ADR-0004
 * anti-enumeration).
 */
export async function listNamespaceAuditEvents(
  input: ListNamespaceAuditEventsInput,
  scope: CallerScope,
): Promise<ListNamespaceAuditEventsOutput> {
  const events = await scope.auditEvents.getByNamespace(input.namespace, {
    limit: input.limit,
  });
  return { events };
}
