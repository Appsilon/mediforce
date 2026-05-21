import type { CallerScope } from '../../repositories/index.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetCoworkSessionInput,
  GetCoworkSessionOutput,
} from '../../contract/cowork.js';

/**
 * Get a single cowork session by id. The wrapper checks the parent run's
 * workspace membership; out-of-scope collapses to 404 — anti-enumeration.
 */
export async function getCoworkSession(
  input: GetCoworkSessionInput,
  scope: CallerScope,
): Promise<GetCoworkSessionOutput> {
  const session = await scope.coworkSessions.getById(input.sessionId);
  if (session === null) {
    throw new NotFoundError(`Cowork session ${input.sessionId} not found`);
  }
  return session;
}
