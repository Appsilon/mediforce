import type { WorkflowAssistantInstructionsRepository } from '@mediforce/platform-core';
import type { CallerIdentity } from '../auth';
import { ForbiddenError } from '../errors';
import { AuthorizedScope } from './authorized-repository';

/**
 * Per-(workspace, user) assistant instructions, gated on both keys.
 *
 * The workspace gate is the usual one. The second gate is what makes this text
 * private: a user caller may only ever read or write its own row, so one
 * member's standing instructions are not reachable from another member's
 * session even inside a workspace they share. apiKey callers are system actors
 * and name the uid themselves — `resolveTargetUid` makes them pass it
 * explicitly rather than inventing an identity.
 *
 * Reads answer `''` for a workspace the caller cannot see, matching
 * `AuthorizedWorkspaceSecretRepository`: a refusal here would confirm the
 * workspace exists.
 */
export class AuthorizedWorkflowAssistantInstructionsRepository extends AuthorizedScope {
  constructor(
    caller: CallerIdentity,
    private readonly raw: WorkflowAssistantInstructionsRepository,
  ) {
    super(caller);
  }

  private assertOwnRow(uid: string): void {
    if (this.caller.isSystemActor) return;
    if (this.caller.uid !== uid) throw new ForbiddenError();
  }

  get = async (namespace: string, uid: string): Promise<string> => {
    if (!this.canSeeNamespace(namespace)) return '';
    this.assertOwnRow(uid);
    const row = await this.raw.get(namespace, uid);
    return row?.instructions ?? '';
  };

  set = async (namespace: string, uid: string, instructions: string): Promise<void> => {
    this.assertNamespaceWrite(namespace);
    this.assertOwnRow(uid);
    await this.raw.set(namespace, uid, instructions);
  };
}
