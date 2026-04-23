import type { CoworkSessionRepository } from '@mediforce/platform-core';
import type {
  GetCoworkSessionByInstanceInput,
  GetCoworkSessionByInstanceOutput,
} from '../../contract/cowork.js';
import { NotFoundError } from '../../errors.js';

export interface GetCoworkSessionByInstanceDeps {
  coworkSessionRepo: CoworkSessionRepository;
}

/**
 * Pure handler: return the most recent *active* cowork session for a given
 * process instance. Missing (no active session) → `NotFoundError`.
 *
 * Mirrors the pre-migration `GET /api/cowork/by-instance/:instanceId` route:
 * only `status === 'active'` sessions are considered; finalized / abandoned
 * sessions do not surface here even if they're the newest.
 */
export async function getCoworkSessionByInstance(
  input: GetCoworkSessionByInstanceInput,
  deps: GetCoworkSessionByInstanceDeps,
): Promise<GetCoworkSessionByInstanceOutput> {
  const session = await deps.coworkSessionRepo.findMostRecentActive(input.instanceId);
  if (session === null) {
    throw new NotFoundError(
      `No active cowork session found for instance '${input.instanceId}'`,
    );
  }
  return session;
}
