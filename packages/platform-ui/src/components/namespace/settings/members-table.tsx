'use client';

import { MailIcon, Trash2, Users } from 'lucide-react';
import type { NamespaceMember } from '@mediforce/platform-core';
import type { NamespaceMemberDetail } from '@/hooks/use-namespace-members';
import { UserProfileLink } from '@/components/user-profile-link';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatLastSignIn(isoString: string): string {
  return new Date(isoString).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function RoleBadge({ role }: { role: NamespaceMember['role'] }) {
  const styles: Record<NamespaceMember['role'], string> = {
    owner: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    admin: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
    member: 'bg-muted text-muted-foreground',
  };

  return (
    <span
      className={[
        'rounded-full px-2 py-0.5 text-[11px] font-medium',
        styles[role],
      ].join(' ')}
    >
      {role}
    </span>
  );
}

interface MembersTableProps {
  members: NamespaceMemberDetail[];
  personalHandles: Map<string, string>;
  canManageMembers: boolean;
  isOwner: boolean;
  currentUserId: string | undefined;
  resendingUid: string | null;
  onResendInvite: (memberUid: string) => void;
  onToggleRole: (memberUid: string, currentRole: string) => void;
  onRemoveMember: (memberUid: string) => void;
}

export function MembersTable({
  members,
  personalHandles,
  canManageMembers,
  isOwner,
  currentUserId,
  resendingUid,
  onResendInvite,
  onToggleRole,
  onRemoveMember,
}: MembersTableProps) {
  if (members.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Users className="h-6 w-6 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No members yet.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b bg-muted/50">
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">User</th>
            {canManageMembers && (
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Email</th>
            )}
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Role</th>
            <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Joined</th>
            {canManageMembers && (
              <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Last sign in</th>
            )}
            <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap sr-only">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {members.map((member) => {
            const name = member.displayName ?? member.uid;
            const avatar = member.avatarUrl;
            const initials = name.includes(' ')
              ? `${name.split(' ')[0]?.[0] ?? ''}${name.split(' ')[1]?.[0] ?? ''}`.toUpperCase()
              : name.slice(0, 2).toUpperCase();
            const lastSignIn = member.lastSignInTime ?? null;

            return (
              <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                {/* User */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <UserProfileLink
                    displayName={name}
                    personalHandle={personalHandles.get(member.uid)}
                    className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
                  >
                    <div className="flex items-center gap-2.5">
                      {avatar !== undefined ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatar} alt={name} className="h-7 w-7 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[11px] font-semibold">
                          {initials}
                        </div>
                      )}
                      <span className="font-medium">{name}</span>
                    </div>
                  </UserProfileLink>
                </td>

                {/* Email — owner/admin only; server returns null for members */}
                {canManageMembers && (
                  <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                    {member.email ?? '—'}
                  </td>
                )}

                {/* Role */}
                <td className="px-4 py-3 whitespace-nowrap">
                  {isOwner && member.role !== 'owner' ? (
                    <button
                      type="button"
                      onClick={() => onToggleRole(member.uid, member.role)}
                      title={`Click to change to ${member.role === 'admin' ? 'member' : 'admin'}`}
                      className="cursor-pointer"
                    >
                      <RoleBadge role={member.role} />
                    </button>
                  ) : (
                    <RoleBadge role={member.role} />
                  )}
                </td>

                {/* Joined */}
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {formatDate(member.joinedAt)}
                </td>

                {/* Last sign in — owner/admin only; server returns null for members */}
                {canManageMembers && (
                  <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                    {lastSignIn === null
                      ? <span className="text-muted-foreground/50">Never</span>
                      : formatLastSignIn(lastSignIn)}
                  </td>
                )}

                {/* Actions */}
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="flex items-center justify-end gap-1">
                    {canManageMembers && member.role !== 'owner' && member.uid !== currentUserId ? (
                      <>
                        {/* Resend only makes sense while the invite is
                            still pending. Once the member has signed in
                            the backend refuses the resend, so hide it
                            rather than surface a confusing error. */}
                        {lastSignIn === null && (
                          <button
                            type="button"
                            onClick={() => onResendInvite(member.uid)}
                            disabled={resendingUid === member.uid}
                            title="Resend invite"
                            className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                            aria-label={`Resend invite to ${name}`}
                          >
                            <MailIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveMember(member.uid)}
                          title="Remove member"
                          className="rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label={`Remove ${name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
