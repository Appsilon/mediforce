import type { ProcessInstance } from '@mediforce/platform-core';

// Mirrors the `displayStatus === 'in_progress' | 'waiting_for_human'` gate from
// the legacy `getWorkflowStatus` UI helper. Kept here (not extracted into
// platform-core) because it's only consumed by archive paths — duplicating one
// list-of-strings is cheaper than coupling core to display-flavored derivations.
// If a third caller needs the same predicate, promote to platform-core.
const ACTIVE_PAUSE_REASONS = new Set([
  'waiting_for_human',
  'awaiting_agent_approval',
  'cowork_in_progress',
  'agent_escalated',
  'agent_paused',
]);

export function isRunActiveForArchive(run: ProcessInstance): boolean {
  if (run.status === 'running' || run.status === 'created') return true;
  if (run.status === 'paused') {
    return ACTIVE_PAUSE_REASONS.has(run.pauseReason ?? '');
  }
  return false;
}
