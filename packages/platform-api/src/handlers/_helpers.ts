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
