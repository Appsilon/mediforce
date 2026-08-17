'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { mediforce } from '@/lib/mediforce';
import { queryKeys } from '@/lib/query-keys';
import type { NamespaceMemberDetail } from '@/hooks/use-namespace-members';
import { useRemoveMember, useUpdateMemberRole } from '@/hooks/use-namespace-mutations';
import { MembersTable } from './members-table';
import { InviteUserForm, type InviteResult } from './invite-user-form';

interface ResendResult {
  email: string;
  emailSent: boolean;
}

interface WorkspaceMembersSectionProps {
  handle: string;
  members: NamespaceMemberDetail[];
  personalHandles: Map<string, string>;
  canManageMembers: boolean;
  isOwner: boolean;
  currentUserId: string | undefined;
  inviterName: string | undefined;
  /** Re-reads the members list after a mutation. */
  onMembersChanged: () => void;
  /** Surfaces a failed member mutation in the page-level danger banner. */
  onError: (message: string | null) => void;
}

export function WorkspaceMembersSection({
  handle,
  members,
  personalHandles,
  canManageMembers,
  isOwner,
  currentUserId,
  inviterName,
  onMembersChanged,
  onError,
}: WorkspaceMembersSectionProps) {
  const qc = useQueryClient();

  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [resendingUid, setResendingUid] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<ResendResult | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  const removeMember = useRemoveMember(handle);
  const updateMemberRole = useUpdateMemberRole(handle);

  async function handleInvited(result: InviteResult) {
    setInviteResult(result);
    setShowInviteForm(false);
    // Refresh the members list — PR4 swapped the previous onSnapshot
    // subscription for `useNamespace` react-query, so the cache needs an
    // explicit invalidation now that the invite mutation isn't a hook.
    await qc.invalidateQueries({ queryKey: queryKeys.namespace(handle) });
    onMembersChanged();
  }

  async function handleResendInvite(memberUid: string) {
    setResendResult(null);
    setResendError(null);
    setResendingUid(memberUid);
    try {
      const data = await mediforce.users.resendInvite({
        uid: memberUid,
        namespaceHandle: handle,
      });
      setResendResult({
        email: data.email,
        emailSent: data.emailSent,
      });
      onMembersChanged();
    } catch (err: unknown) {
      // The button is hidden once a member has signed in, but a member who set
      // a password without ever signing in still isn't pending, so the handler
      // throws PreconditionFailed. Surface it here — the invite form's own
      // error only renders inside the (closed) form, so it would be silent.
      setResendError(
        err instanceof Error ? err.message : 'Failed to resend invite.',
      );
    } finally {
      setResendingUid(null);
    }
  }

  async function handleRemoveMember(memberUid: string) {
    onError(null);
    try {
      await removeMember.mutateAsync({ handle, uid: memberUid });
      onMembersChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to remove member.');
    }
  }

  async function handleToggleRole(memberUid: string, currentRole: string) {
    onError(null);
    const nextRole: 'admin' | 'member' = currentRole === 'admin' ? 'member' : 'admin';
    try {
      await updateMemberRole.mutateAsync({ handle, uid: memberUid, role: nextRole });
      onMembersChanged();
    } catch (err: unknown) {
      onError(err instanceof Error ? err.message : 'Failed to update member role.');
    }
  }

  return (
    <div className="mb-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Members</h2>
        {canManageMembers && !showInviteForm && (
          <button
            type="button"
            onClick={() => { setInviteResult(null); setShowInviteForm(true); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Invite user
          </button>
        )}
      </div>

      {/* Resend result card */}
      {resendResult !== null && (
        <div className="mb-4 rounded-lg border border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30 px-4 py-4">
          <div className="flex items-start gap-2">
            <Check className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                Invite resent to {resendResult.email}
              </p>
              <p className="text-sm text-blue-700 dark:text-blue-300">
                They can sign in with Google or set a password.
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-400">
                {resendResult.emailSent
                  ? 'Email sent ✓'
                  : 'Email not sent — let them know to sign in'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setResendResult(null)}
              className="ml-auto text-blue-400 hover:text-blue-600 transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Resend error card */}
      {resendError !== null && (
        <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-4">
          <div className="flex items-start gap-2">
            <p className="text-sm font-medium text-destructive">{resendError}</p>
            <button
              type="button"
              onClick={() => setResendError(null)}
              className="ml-auto text-destructive/60 hover:text-destructive transition-colors text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Invite result card */}
      {inviteResult !== null && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-4">
          <div className="flex items-start gap-2">
            <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
            <div className="space-y-1 min-w-0">
              <p className="text-sm font-medium text-green-800 dark:text-green-200">
                {inviteResult.isExisting
                  ? `${inviteResult.email} added to workspace`
                  : `Invited ${inviteResult.email}`}
              </p>
              {!inviteResult.isExisting && (
                <p className="text-sm text-green-700 dark:text-green-300">
                  They can sign in with Google or set a password.
                </p>
              )}
              <p className="text-xs text-green-600 dark:text-green-400">
                {inviteResult.emailSent
                  ? 'Email sent ✓'
                  : inviteResult.isExisting
                    ? 'Email not sent'
                    : 'Email not sent — let them know to sign in'}
              </p>
            </div>
          </div>
        </div>
      )}

      <MembersTable
        members={members}
        personalHandles={personalHandles}
        canManageMembers={canManageMembers}
        isOwner={isOwner}
        currentUserId={currentUserId}
        resendingUid={resendingUid}
        onResendInvite={handleResendInvite}
        onToggleRole={handleToggleRole}
        onRemoveMember={handleRemoveMember}
      />

      {showInviteForm && canManageMembers && (
        <InviteUserForm
          handle={handle}
          inviterName={inviterName}
          onInvited={handleInvited}
          onCancel={() => setShowInviteForm(false)}
        />
      )}
    </div>
  );
}
