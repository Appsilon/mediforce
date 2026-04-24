import type { AuditRepository } from '@mediforce/platform-core';
import type {
  ListAuditEventsInput,
  ListAuditEventsOutput,
} from '../../contract/processes.js';

export interface ListAuditEventsDeps {
  auditRepo: AuditRepository;
}

/**
 * Pure handler: every audit event for a process instance. Current backing
 * store returns the full list in one shot — pagination is tracked in #231
 * and will extend the contract with `limit + cursor` once the repo grows
 * the matching interface.
 */
export async function listAuditEvents(
  input: ListAuditEventsInput,
  deps: ListAuditEventsDeps,
): Promise<ListAuditEventsOutput> {
  const events = await deps.auditRepo.getByProcess(input.instanceId);
  return { events };
}
