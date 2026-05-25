import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetCoworkSessionByInstanceInput,
  GetCoworkSessionByInstanceOutput,
} from '../../contract/cowork.js';

/**
 * Get the most recent *active* cowork session for a given process instance.
 * Missing instance / no active session / cross-namespace access → all surface
 * as the same `NotFoundError`. Wrapper gates by parent run; only
 * `status === 'active'` sessions are considered.
 */
export async function getCoworkSessionByInstance(
  input: GetCoworkSessionByInstanceInput,
  scope: CallerScope,
): Promise<GetCoworkSessionByInstanceOutput> {
  const session = await scope.coworkSessions.findMostRecentActiveForInstance(input.instanceId);
  if (session === null) {
    throw new NotFoundError(
      `No active cowork session found for instance '${input.instanceId}'`,
    );
  }
  return session;
}
