import type {
  CoworkSessionRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { callerCanAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetCoworkSessionInput,
  GetCoworkSessionOutput,
} from '../../contract/cowork.js';

export interface GetCoworkSessionDeps {
  coworkSessionRepo: CoworkSessionRepository;
  /** Used to resolve the session's parent instance for namespace gating. */
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Get a single cowork session by id. The parent process instance's namespace
 * gates access — api-key callers always pass, user callers must be members of
 * the instance's namespace. Access denial surfaces as 404 (not 403) so a
 * non-member caller cannot distinguish "exists but denied" from "doesn't
 * exist" — eliminates the ID-enumeration leak.
 *
 * The payload includes the full conversation history (`turns`) and the
 * current `artifact` — the route adapter serialises it verbatim.
 */
export async function getCoworkSession(
  input: GetCoworkSessionInput,
  deps: GetCoworkSessionDeps,
  caller: CallerIdentity,
): Promise<GetCoworkSessionOutput> {
  const session = await deps.coworkSessionRepo.getById(input.sessionId);
  if (session === null) {
    throw new NotFoundError(`Cowork session ${input.sessionId} not found`);
  }

  const instance = await deps.instanceRepo.getById(session.processInstanceId);
  if (!callerCanAccess(caller, instance?.namespace)) {
    throw new NotFoundError(`Cowork session ${input.sessionId} not found`);
  }

  return session;
}
