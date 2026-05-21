import type {
  AuditEvent,
  AuditRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth.js';
import { AuthorizedRepository } from './authorized-repository.js';

/**
 * Workspace-scoped audit-event reads. Events have no workspace field; the
 * wrapper gates by the parent `ProcessInstance`. Out-of-scope or missing
 * parent yields an empty list — handlers surface that as 404 when the parent
 * lookup is the access decision (see PR #450's `listAuditEvents` shape).
 */
export interface AuthorizedAuditEventRepository {
  getByProcess(processInstanceId: string): Promise<AuditEvent[]>;
  append(event: Omit<AuditEvent, 'serverTimestamp'>): Promise<AuditEvent>;
}

export class AuthorizedAuditEventRepositoryImpl
  extends AuthorizedRepository<AuditEvent>
  implements AuthorizedAuditEventRepository
{
  constructor(
    caller: CallerIdentity,
    private readonly raw: AuditRepository,
    private readonly parents: ProcessInstanceRepository,
  ) {
    super(caller);
  }

  getByProcess = async (processInstanceId: string): Promise<AuditEvent[]> => {
    if (this.caller.kind === 'apiKey') return this.raw.getByProcess(processInstanceId);
    const parent = await this.parents.getById(processInstanceId);
    if (!this.canSeeNamespace(parent?.namespace)) return [];
    return this.raw.getByProcess(processInstanceId);
  };

  /** Append is a system-actor operation routed through the engine in practice;
   *  callers via the API are typically apiKey. Gate by parent run when present. */
  append = async (event: Omit<AuditEvent, 'serverTimestamp'>): Promise<AuditEvent> => {
    if (this.caller.kind === 'apiKey') return this.raw.append(event);
    const parent = event.processInstanceId !== undefined
      ? await this.parents.getById(event.processInstanceId)
      : null;
    if (!this.canSeeNamespace(parent?.namespace)) {
      throw new Error('Forbidden');
    }
    return this.raw.append(event);
  };
}
