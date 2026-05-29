import { assertCallerIsNamespaceAdmin } from '../../auth.js';
import { PreconditionFailedError } from '../../errors.js';
import type { CallerScope } from '../../repositories/index.js';
import type { InviteUserInput, InviteUserOutput } from '../../contract/users.js';
import { actorFromCaller } from '../_helpers.js';

/**
 * Invite a user to a workspace.
 *
 * Behavior (preserves the legacy `/api/users/invite` route, minus inline
 * Firebase / Mailgun coupling):
 *
 *   1. Caller must be `owner`/`admin` of `namespaceHandle` (apiKey bypass).
 *   2. Create or look up the Firebase Auth user via
 *      `scope.system.inviteService.createInvitedUser`. Returns
 *      `isExisting: true` for pre-existing accounts (no password issued).
 *   3. Add the user to the namespace via `scope.workspaces.addMember` — the
 *      Firestore impl also denormalizes the handle into
 *      `users/{uid}.organizations` so `getUserNamespaces` sees them.
 *   4. Best-effort email delivery via `scope.system.inviteNotificationService`:
 *      pre-existing user → workspace-notification email,
 *      new user → invite-credentials email. Email failures don't fail the
 *      response — `emailSent` flips to `false` and the temp password is
 *      still returned so the admin can hand it over manually.
 *   5. Append `invitation.created` to the audit log.
 *
 * `scope.system.inviteService === null` → `PreconditionFailedError` (the
 * deployment isn't wired for Firebase Auth — surface clearly rather than
 * 500).
 */
export async function inviteUser(
  input: InviteUserInput,
  scope: CallerScope,
): Promise<InviteUserOutput> {
  assertCallerIsNamespaceAdmin(scope.caller, input.namespaceHandle);

  const invite = scope.system.inviteService;
  if (invite === null) {
    throw new PreconditionFailedError('Invite service is not configured');
  }

  const email = input.email.trim().toLowerCase();
  const displayName =
    typeof input.displayName === 'string' && input.displayName.trim() !== ''
      ? input.displayName.trim()
      : undefined;

  const { uid, temporaryPassword, isExisting } = await invite.createInvitedUser(
    email,
    displayName,
  );

  await scope.workspaces.addMember(input.namespaceHandle, {
    uid,
    role: input.role,
    ...(displayName !== undefined ? { displayName } : {}),
    joinedAt: new Date().toISOString(),
  });

  let emailSent = false;
  const notify = scope.system.inviteNotificationService;
  if (notify !== null) {
    try {
      if (isExisting) {
        const namespace = await scope.workspaces.getNamespace(input.namespaceHandle);
        const workspaceName = namespace?.displayName ?? input.namespaceHandle;
        const inviterName =
          typeof input.inviterName === 'string' && input.inviterName.trim() !== ''
            ? input.inviterName.trim()
            : workspaceName;
        await notify.sendWorkspaceNotificationEmail({
          toEmail: email,
          inviterName,
          workspaceName,
          workspaceHandle: input.namespaceHandle,
        });
      } else {
        await notify.sendInviteEmail({ toEmail: email, temporaryPassword });
      }
      emailSent = true;
    } catch (emailErr) {
      console.error('[invite-user] Failed to send email:', emailErr);
      emailSent = false;
    }
  }

  await scope.system.audit.append({
    ...actorFromCaller(scope),
    action: 'invitation.created',
    description: `User '${email}' invited to namespace '${input.namespaceHandle}' as ${input.role}`,
    timestamp: new Date().toISOString(),
    inputSnapshot: {
      email,
      namespaceHandle: input.namespaceHandle,
      role: input.role,
      ...(displayName !== undefined ? { displayName } : {}),
    },
    outputSnapshot: { uid, isExisting, emailSent },
    basis: 'User invited via API',
    entityType: 'invitation',
    entityId: uid,
    namespace: input.namespaceHandle,
  });

  return { uid, email, temporaryPassword, emailSent, isExisting };
}
