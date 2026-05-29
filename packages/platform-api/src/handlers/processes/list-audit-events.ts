import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type {
  ListAuditEventsInput,
  ListAuditEventsOutput,
} from '../../contract/processes';

/**
 * Every audit event for a process instance, wrapped as `{ events }`. The
 * wrapper is intentional — a breaking response-shape change vs `main` (which
 * returned the bare array) that keeps a later `nextCursor` field additive
 * when pagination lands (#231).
 *
 * Workspace gating lives in the run wrapper: missing or out-of-scope parent
 * surfaces as 404 with no enumeration leak.
 */
export async function listAuditEvents(
  input: ListAuditEventsInput,
  scope: CallerScope,
): Promise<ListAuditEventsOutput> {
  const instance = await scope.runs.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }
  const events = await scope.auditEvents.getByProcess(input.instanceId);
  return { events };
}
