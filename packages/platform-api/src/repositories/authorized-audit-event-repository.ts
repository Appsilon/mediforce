import type {
  AuditEvent,
  AuditRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped audit-event reads. Events have no workspace field; the
 * raw repo resolves namespace via the parent `ProcessInstance`. Out-of-scope
 * or missing parent yields an empty list — handlers surface that as 404 when
 * the parent lookup is the access decision.
 */
export class AuthorizedAuditEventRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AuditRepository,
  ) {
    super(caller);
  }

  getByProcess = async (processInstanceId: string): Promise<AuditEvent[]> =>
    this.caller.isSystemActor
      ? this.raw.getByProcess(processInstanceId)
      : this.raw.getByProcessInNamespaces(processInstanceId, [...this.caller.namespaces]);
}
