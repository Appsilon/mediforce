import type {
  AuditRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { assertNamespaceAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  ListAuditEventsInput,
  ListAuditEventsOutput,
} from '../../contract/processes.js';

export interface ListAuditEventsDeps {
  auditRepo: AuditRepository;
  /** Used to resolve the instance's namespace for access gating. */
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Every audit event for a process instance, wrapped as `{ events }`. The
 * wrapper is intentional — a breaking response-shape change vs `main` (which
 * returned the bare array) that keeps a later `nextCursor` field additive
 * when pagination lands (#231).
 *
 * Namespace gating: api-key callers always pass, user callers must be
 * members of the instance's namespace. 404 surfaces before 403 — a missing
 * instance never reveals "exists but denied".
 */
export async function listAuditEvents(
  input: ListAuditEventsInput,
  deps: ListAuditEventsDeps,
  caller: CallerIdentity,
): Promise<ListAuditEventsOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }

  assertNamespaceAccess(caller, instance.namespace);

  const events = await deps.auditRepo.getByProcess(input.instanceId);
  return { events };
}
