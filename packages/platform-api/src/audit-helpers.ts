import type { AuditEvent, AuditRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from './auth.js';

/**
 * Derive the `actorId` / `actorType` / `actorRole` triple from a caller. User
 * callers are operators acting on their own behalf; apiKey callers (CLI,
 * agent runtime) are attributed as the `system` actor with no uid.
 */
export function auditActorFrom(caller: CallerIdentity): Pick<AuditEvent, 'actorId' | 'actorType' | 'actorRole'> {
  if (caller.kind === 'user') {
    return { actorId: caller.uid, actorType: 'user', actorRole: 'operator' };
  }
  return { actorId: 'system', actorType: 'system', actorRole: 'system' };
}

/**
 * Append an audit event with sensible defaults: `timestamp` set to `now`,
 * actor triple derived from `caller`. The handler still supplies the
 * domain-specific fields (`action`, `description`, snapshots, `basis`,
 * `entityType`, `entityId`).
 *
 * Returns the resolved ISO timestamp so handlers can reuse it if they need
 * to surface it in their own response (rare).
 */
export async function emitAudit(
  audit: AuditRepository,
  caller: CallerIdentity,
  event: Omit<AuditEvent, 'actorId' | 'actorType' | 'actorRole' | 'timestamp'> & { timestamp?: string },
): Promise<string> {
  const timestamp = event.timestamp ?? new Date().toISOString();
  await audit.append({ ...auditActorFrom(caller), ...event, timestamp });
  return timestamp;
}
