import type { Database } from '../postgres/client';
import { PostgresAuditRepository } from '../postgres/repositories/audit-repository';
import { PostgresNamespaceRepository } from '../postgres/repositories/namespace-repository';
import { PostgresProcessInstanceRepository } from '../postgres/repositories/process-instance-repository';

export type SignInMethod =
  | { kind: 'password'; ipAddress: string | null; userAgent: string | null }
  | { kind: 'oauth'; provider: string };

/**
 * Append a `user.signed_in` audit event for every workspace the user
 * belongs to (Monitoring → Users tab, ADR: sign-in isn't scoped to a single
 * workspace, and `audit_events.workspace` is NOT NULL, so one row per
 * membership is the only way every relevant workspace's Users tab sees it).
 *
 * Password sign-in carries the real IP/user-agent (available on the login
 * route's Request). OAuth/SSO sign-in carries the provider instead — Auth.js
 * v5's `signIn` event callback never receives the request object, so IP/UA
 * isn't capturable there without a request-scoped bridge; the provider name
 * is a real, honest substitute rather than faking "no data".
 *
 * A user with zero memberships (mid-bootstrap) writes nothing — there is no
 * workspace to attribute the event to yet.
 */
export async function recordSignInAuditEvent(
  db: Database,
  params: { uid: string; method: SignInMethod },
): Promise<void> {
  const namespaceRepo = new PostgresNamespaceRepository(db);
  const memberships = await namespaceRepo.getMembershipsForUser(params.uid);
  if (memberships.length === 0) return;

  const auditRepo = new PostgresAuditRepository(db, new PostgresProcessInstanceRepository(db));
  const timestamp = new Date().toISOString();
  const { description, inputSnapshot, basis } = auditFieldsFor(params.method);

  await Promise.all(
    memberships.map((membership) =>
      auditRepo.append({
        actorId: params.uid,
        actorType: 'user',
        actorRole: membership.role,
        action: 'user.signed_in',
        description,
        timestamp,
        inputSnapshot,
        outputSnapshot: {},
        basis,
        entityType: 'user',
        entityId: params.uid,
        namespace: membership.handle,
      }),
    ),
  );
}

function auditFieldsFor(method: SignInMethod): {
  description: string;
  inputSnapshot: Record<string, unknown>;
  basis: string;
} {
  if (method.kind === 'password') {
    return {
      description: 'Signed in with email and password',
      inputSnapshot: { method: 'password', ipAddress: method.ipAddress, userAgent: method.userAgent },
      basis: 'Password credential verified',
    };
  }
  return {
    description: `Signed in via ${method.provider} (SSO)`,
    inputSnapshot: { method: 'oauth', provider: method.provider },
    basis: `OAuth provider '${method.provider}' verified the identity`,
  };
}
