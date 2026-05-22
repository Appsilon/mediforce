import type {
  AuditEvent,
  AuditRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedScope } from './authorized-repository.js';

/**
 * Workspace-scoped audit-event reads. Events have no workspace field; the
 * wrapper gates by the parent `ProcessInstance`. Out-of-scope or missing
 * parent yields an empty list — handlers surface that as 404 when the parent
 * lookup is the access decision (see PR #450's `listAuditEvents` shape).
 */
export class AuthorizedAuditEventRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: AuditRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getByProcess = async (processInstanceId: string): Promise<AuditEvent[]> => {
    const parent = await this.parents.getById(processInstanceId);
    if (!this.canSeeNamespace(parent?.namespace)) return [];
    return this.raw.getByProcess(processInstanceId);
  };
}
