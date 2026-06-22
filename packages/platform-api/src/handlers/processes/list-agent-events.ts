import type { CallerScope } from '../../repositories/index';
import { NotFoundError } from '../../errors';
import type { ListAgentEventsInput, ListAgentEventsOutput } from '../../contract/processes';

/**
 * Agent event feed for a process instance, wrapped as `{ events }` (matches
 * the audit endpoint's shape so pagination can stay additive when it lands).
 * Optional `stepId` narrows the feed to one step; absent returns the full
 * per-instance log.
 *
 * Workspace gating happens in the parent-run lookup: missing or out-of-scope
 * parent surfaces as 404 with no enumeration leak. The agent-events wrapper
 * also collapses to empty for out-of-namespace callers, but the explicit
 * parent gate is what produces the 404 — same pattern as `listAuditEvents`.
 *
 * Ordering: `sequence ASC` (per `AgentEventSchema` — Firestore timestamps
 * alone aren't reliable for ordering concurrent emits).
 *
 * `afterSequence` is the incremental-poll cursor: when set, only events with
 * `sequence > afterSequence` come back, so the live poller fetches deltas
 * instead of re-reading the whole subcollection every tick.
 */
export async function listAgentEvents(input: ListAgentEventsInput, scope: CallerScope): Promise<ListAgentEventsOutput> {
  const instance = await scope.runs.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(`Process instance ${input.instanceId} not found`);
  }
  const events =
    input.stepId !== undefined
      ? await scope.agentEvents.listByStep(input.instanceId, input.stepId, input.afterSequence)
      : await scope.agentEvents.listByInstance(input.instanceId, input.afterSequence);
  return { events };
}
