import type { CoworkSessionStatus } from '@mediforce/platform-core';
import type { CallerScope } from '../../repositories/index';
import type {
  ListCoworkSessionsInput,
  ListCoworkSessionsOutput,
} from '../../contract/cowork';

/**
 * List cowork sessions visible to the caller. Workspace gating is enforced by
 * the `scope.coworkSessions` wrapper: api-key callers see every session, user
 * callers only see sessions whose parent run belongs to a workspace they're a
 * member of. With no filters, returns the caller-scope queue (mirrors the
 * `tasks.list({})` GitHub-like default).
 *
 * Input validation is the adapter's job. Output validation is the contract's
 * job — handlers conform by type, not by runtime parse.
 */
export async function listCoworkSessions(
  input: ListCoworkSessionsInput,
  scope: CallerScope,
): Promise<ListCoworkSessionsOutput> {
  const base = await scope.coworkSessions.list({ role: input.role });
  const statusSet =
    input.status !== undefined ? new Set<CoworkSessionStatus>(input.status) : null;
  const sessions = statusSet === null ? base : base.filter((s) => statusSet.has(s.status));
  return { sessions };
}
