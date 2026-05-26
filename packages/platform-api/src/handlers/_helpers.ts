import { NotFoundError } from '../errors.js';
import type { CallerScope } from '../repositories/index.js';

export async function loadOr404<T>(
  lookup: Promise<T | null>,
  notFoundMessage: string,
): Promise<T> {
  const entity = await lookup;
  if (entity === null) throw new NotFoundError(notFoundMessage);
  return entity;
}

export interface Actor {
  readonly actorId: string;
  readonly actorType: 'user' | 'system';
  readonly actorRole: string;
}

// Derive the audit-event actor fields from the caller. Default role is
// 'operator'; cron-style handlers override.
export function actorFromCaller(scope: CallerScope, role = 'operator'): Actor {
  if (scope.caller.kind === 'user') {
    return { actorId: scope.caller.uid, actorType: 'user', actorRole: role };
  }
  return { actorId: 'api-user', actorType: 'system', actorRole: role };
}

export interface EmitAuditArgs {
  readonly action: string;
  readonly description: string;
  readonly basis: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly processInstanceId: string;
  readonly processDefinitionVersion?: string;
  readonly inputSnapshot?: Record<string, unknown>;
  readonly outputSnapshot?: Record<string, unknown>;
  readonly actor?: Actor;
  readonly timestamp?: string;
}

// Append a single audit event via scope.system.audit. Collapses the
// 12-field literal every handler used to inline. Actor defaults to
// `actorFromCaller(scope)`; timestamp defaults to now.
export async function emitAudit(
  scope: CallerScope,
  args: EmitAuditArgs,
): Promise<void> {
  const actor = args.actor ?? actorFromCaller(scope);
  await scope.system.audit.append({
    ...actor,
    action: args.action,
    description: args.description,
    timestamp: args.timestamp ?? new Date().toISOString(),
    inputSnapshot: args.inputSnapshot ?? {},
    outputSnapshot: args.outputSnapshot ?? {},
    basis: args.basis,
    entityType: args.entityType,
    entityId: args.entityId,
    processInstanceId: args.processInstanceId,
    ...(args.processDefinitionVersion !== undefined
      ? { processDefinitionVersion: args.processDefinitionVersion }
      : {}),
  });
}
