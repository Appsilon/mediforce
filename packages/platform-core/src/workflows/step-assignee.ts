import type { UserDirectoryService } from '../interfaces/user-directory-service';

export interface ResolvedStepAssignee {
  // The uid the task is pinned to, or null when nobody could be resolved.
  userId: string | null;
  email: string | null;
  // The value that named nobody, for the audit trail.
  unresolved: string | null;
}

// Who a step's `assignedTo` actually names, after interpolation.
export async function resolveStepAssignee(
  value: string,
  directory: Pick<UserDirectoryService, 'resolveUser'> | undefined,
): Promise<ResolvedStepAssignee> {
  const unresolved = { userId: null, email: null, unresolved: value };
  // `resolveUser` takes a uid or an email, so there is no shape to test for here: asking is what tells us whether anybody holds the value.
  if (directory?.resolveUser === undefined) return unresolved;
  const user = await directory.resolveUser(value);
  if (user === null || user === undefined) return unresolved;
  return { userId: user.uid, email: user.email ?? null, unresolved: null };
}
