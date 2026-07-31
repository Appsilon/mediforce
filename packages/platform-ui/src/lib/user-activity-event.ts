import type { AuditEvent } from '@mediforce/platform-core';
import { formatStepName } from './format';

/** The four actions the Users tab activity table understands. Passed
 *  server-side as the `actions` filter (`useNamespaceAuditEventsPage`) so a
 *  fetched page only ever contains what this table claims to show — real
 *  filtering at the query layer, not a client-side pass over an
 *  over-fetched, unfiltered read. */
export const USER_ACTIVITY_ACTIONS = [
  'user.signed_in',
  'instance.started',
  'instance.cancelled',
  'task.completed',
] as const;

const EVENT_NAMES: Record<string, string> = {
  'user.signed_in': 'Sign in',
  'instance.started': 'Workflow triggered',
  'instance.cancelled': 'Workflow cancelled',
  'task.completed': 'Task completed',
};

export function formatEventName(action: string): string {
  return EVENT_NAMES[action] ?? action;
}

function formatSignInDetails(inputSnapshot: Record<string, unknown>): string {
  if (inputSnapshot.method === 'oauth') {
    const provider = typeof inputSnapshot.provider === 'string' ? inputSnapshot.provider : 'unknown';
    return `Signed in via ${provider} (SSO)`;
  }
  const ip = typeof inputSnapshot.ipAddress === 'string' ? inputSnapshot.ipAddress : null;
  const userAgent = typeof inputSnapshot.userAgent === 'string' ? inputSnapshot.userAgent : null;
  if (ip === null && userAgent === null) return 'no data';
  return [ip ? `IP ${ip}` : null, userAgent].filter(Boolean).join(' · ');
}

/** `processNames`: processInstanceId -> workflow definition name, e.g. from
 *  useProcessNameMap — the same lookup the Agents tab already uses. */
export function formatEventDetails(
  event: AuditEvent,
  processNames: Map<string, string>,
): string {
  switch (event.action) {
    case 'user.signed_in':
      return formatSignInDetails(event.inputSnapshot);
    case 'instance.started':
    case 'instance.cancelled': {
      const name = event.processInstanceId ? processNames.get(event.processInstanceId) : undefined;
      return name ?? 'no data';
    }
    case 'task.completed': {
      const stepId = event.inputSnapshot.stepId;
      return typeof stepId === 'string' ? formatStepName(stepId) : 'no data';
    }
    default:
      return 'no data';
  }
}
