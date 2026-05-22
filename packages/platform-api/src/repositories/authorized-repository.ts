import type { CallerIdentity } from '../auth.js';
import { ForbiddenError } from '../errors.js';

/**
 * Workspace-scope base for `Authorized<Entity>Repository` wrappers in
 * `platform-api`. Per ADR-0004 §"Storage-layer filter, today", read gating
 * for direct- and indirect-namespace entities lives in the raw repository
 * (`*InNamespaces` / `*VisibleTo` variants); those wrappers route on
 * `caller.isSystemActor` and do not call into this base for reads.
 *
 * Path-prefix wrappers (ToolCatalog, OAuthProvider, AgentOAuthToken,
 * Workflow/WorkspaceSecrets) still gate on a namespace they receive as a
 * direct argument — they use `canSeeNamespace` for the read predicate
 * and `assertNamespaceWrite` for writes.
 *
 * Subclass once per entity. Construct with the caller; instances are
 * per-request and disposable.
 */
export abstract class AuthorizedScope {
  constructor(protected readonly caller: CallerIdentity) {}

  protected canSeeNamespace(namespace: string | undefined): boolean {
    if (this.caller.isSystemActor) return true;
    return typeof namespace === 'string' && this.caller.namespaces.has(namespace);
  }

  protected assertNamespaceWrite(namespace: string | undefined): void {
    if (this.caller.isSystemActor) return;
    if (typeof namespace !== 'string' || !this.caller.namespaces.has(namespace)) {
      throw new ForbiddenError();
    }
  }
}
