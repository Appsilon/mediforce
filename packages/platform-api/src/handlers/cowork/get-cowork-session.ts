import type { CoworkSessionRepository } from '@mediforce/platform-core';
import type {
  GetCoworkSessionInput,
  GetCoworkSessionOutput,
} from '../../contract/cowork.js';
import { NotFoundError } from '../../errors.js';

export interface GetCoworkSessionDeps {
  coworkSessionRepo: CoworkSessionRepository;
}

/**
 * Pure handler: return the cowork session by id. Missing → `NotFoundError`.
 *
 * The session payload includes the full conversation history (`turns`) and
 * the current `artifact` — the route adapter serialises it verbatim.
 */
export async function getCoworkSession(
  input: GetCoworkSessionInput,
  deps: GetCoworkSessionDeps,
): Promise<GetCoworkSessionOutput> {
  const session = await deps.coworkSessionRepo.getById(input.sessionId);
  if (session === null) {
    throw new NotFoundError(`Cowork session ${input.sessionId} not found`);
  }
  return session;
}
