import type { AuditEvent } from '@mediforce/platform-core';
import { formatStepName } from './format';

/** The four actions the Users tab activity table understands. Everything
 *  else audit_events carries (agent.*, workflow.*, namespace.*, ...) is
 *  real data too, just not "user activity" in the sense this table means —
 *  filtering here, not at the query layer, keeps the read simple (one
 *  namespace-wide fetch) while the table only ever shows what it claims to. */
const USER_ACTIVITY_ACTIONS = new Set([
  'user.signed_in',
  'instance.started',
  'instance.cancelled',
  'task.completed',
]);

export function isUserActivityEvent(event: AuditEvent): boolean {
  return USER_ACTIVITY_ACTIONS.has(event.action);
}

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

export interface UserActivityFilters {
  actorId: string | null;
  action: string | null;
  /** `YYYY-MM-DD`, as produced by `<input type="date">` — inclusive of the
   *  whole local day. */
  fromDate: string | null;
  toDate: string | null;
}

export function filterUserActivity(
  events: AuditEvent[],
  filters: UserActivityFilters,
): AuditEvent[] {
  const from = filters.fromDate ? new Date(`${filters.fromDate}T00:00:00.000`) : null;
  const to = filters.toDate ? new Date(`${filters.toDate}T23:59:59.999`) : null;

  return events.filter((event) => {
    if (filters.actorId !== null && event.actorId !== filters.actorId) return false;
    if (filters.action !== null && event.action !== filters.action) return false;
    const eventTime = new Date(event.timestamp);
    if (from !== null && eventTime < from) return false;
    if (to !== null && eventTime > to) return false;
    return true;
  });
}
