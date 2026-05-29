import type { CallerIdentity } from '../auth';
import { ForbiddenError } from '../errors';

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
 *
 * TODO(ADR-0004 Phase 2): mutation methods (`claim`, `complete`, `resolve`,
 * `cancel`, `upsert`, etc.) are present on several wrappers but have no
 * handler caller yet — they're armed surface, not inert. The Phase 2 PR
 * that wires the mutation handlers must (a) re-audit each mutation's
 * pre-conditions (lifecycle state, role, ownership — none of which the
 * wrapper enforces today), (b) narrow `Partial<Entity>` patch types to
 * exclude `namespace` / `deleted` where applicable (see
 * `AuthorizedWorkflowRunRepository.update` for the pattern), and
 * (c) add wrapper-level tests for each mutation, not just the handler.
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
