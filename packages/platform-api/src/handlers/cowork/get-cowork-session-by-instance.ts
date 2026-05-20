import type {
  CoworkSessionRepository,
  ProcessInstanceRepository,
} from '@mediforce/platform-core';
import { callerCanAccess, type CallerIdentity } from '../../auth.js';
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
 * Missing instance / no active session / cross-namespace access → all surface
 * as the same `NotFoundError`. This is deliberate anti-probing: a non-member
 * caller cannot distinguish "instance exists in another namespace" from
 * "instance doesn't exist" from "instance exists but has no active session".
 *
 * Namespace gating runs AFTER the instance is fetched (we can't gate on a
 * namespace we don't know) but BEFORE searching for sessions — otherwise the
 * presence/absence of an active session would leak through timing/cost even
 * though the response is identical.
 *
 * Mirrors the pre-migration `GET /api/cowork/by-instance/:instanceId` route:
 * only `status === 'active'` sessions are considered; finalized / abandoned
 * sessions do not surface here even if they're the newest.
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

  if (!callerCanAccess(caller, instance.namespace)) {
    throw new NotFoundError(
      `No active cowork session found for instance '${input.instanceId}'`,
    );
  }

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
