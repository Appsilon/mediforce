import type { UserDirectoryService } from '../interfaces/user-directory-service';

export interface ResolvedStepAssignee {
  /** The uid the task is pinned to, or null when nobody could be resolved. */
  userId: string | null;
  email: string | null;
  /** The value that named nobody, for the audit trail. Null when it resolved. */
  unresolved: string | null;
}

/**
 * Who a step's `assignedTo` actually names, after interpolation.
 *
 * A task's `assignedUserId` has to be a Mediforce uid: the queues surface a
 * claimed task only to the viewer whose uid matches, and `completeTask` refuses
 * everyone else. So a value that resolves to nobody is not an assignee — taking
 * it verbatim produced a task claimed by an id nobody holds, and with no
 * unclaim, no reassign and no owner override, the run could not be finished by
 * anyone. Reported as unresolved instead, which leaves the task claimable by
 * whoever holds the step's role.
 *
 * Shared by the engine's `advanceStep` and the auto-runner route, which each
 * had their own version and disagreed: one failed the whole run on an
 * unresolvable address, the other pinned a job title as if it were a uid.
 */
export async function resolveStepAssignee(
  value: string,
  directory: Pick<UserDirectoryService, 'resolveUser'> | undefined,
): Promise<ResolvedStepAssignee> {
  const unresolved = { userId: null, email: null, unresolved: value };
  // `resolveUser` takes a uid or an email, so there is no shape to test for
  // here: asking is what tells us whether anybody holds the value.
  if (directory?.resolveUser === undefined) return unresolved;
  const user = await directory.resolveUser(value);
  if (user === null || user === undefined) return unresolved;
  return { userId: user.uid, email: user.email ?? null, unresolved: null };
}
