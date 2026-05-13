import type {
  CoworkSessionRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { assertNamespaceAccess, type CallerIdentity } from '../../auth.js';
import { NotFoundError } from '../../errors.js';
import type {
  GetCoworkSessionByInstanceInput,
  GetCoworkSessionByInstanceOutput,
} from '../../contract/cowork.js';

export interface GetCoworkSessionByInstanceDeps {
  coworkSessionRepo: CoworkSessionRepository;
  /** Used to gate access by the instance's namespace. */
  instanceRepo: ProcessInstanceRepository;
}

/**
 * Get the most recent *active* cowork session for a given process instance.
 * Missing instance / no active session → `NotFoundError`. Namespace gating
 * runs against the instance's namespace — api-key callers always pass, user
 * callers must be members.
 *
 * 404 beats 403: a non-existent instance surfaces as 404 (we can't gate on a
 * namespace we don't know), keeping behaviour consistent with the rest of the
 * platform. Mirrors the pre-migration `GET /api/cowork/by-instance/:instanceId`
 * route: only `status === 'active'` sessions are considered; finalized /
 * abandoned sessions do not surface here even if they're the newest.
 */
export async function getCoworkSessionByInstance(
  input: GetCoworkSessionByInstanceInput,
  deps: GetCoworkSessionByInstanceDeps,
  caller: CallerIdentity,
): Promise<GetCoworkSessionByInstanceOutput> {
  const instance = await deps.instanceRepo.getById(input.instanceId);
  if (instance === null) {
    throw new NotFoundError(
      `No active cowork session found for instance '${input.instanceId}'`,
    );
  }

  assertNamespaceAccess(caller, instance.namespace);

  const session = await deps.coworkSessionRepo.findMostRecentActive(
    input.instanceId,
  );
  if (session === null) {
    throw new NotFoundError(
      `No active cowork session found for instance '${input.instanceId}'`,
    );
  }
  return session;
}
