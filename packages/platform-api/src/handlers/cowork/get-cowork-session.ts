import type {
  CoworkSessionRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { assertNamespaceAccess, type CallerIdentity } from '../../auth.js';
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
 * the instance's namespace. 404 surfaces before 403 (a non-existent id never
 * reveals "exists but denied").
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
  assertNamespaceAccess(caller, instance?.namespace);

  return session;
}
