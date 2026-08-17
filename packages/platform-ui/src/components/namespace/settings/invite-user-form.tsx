'use client';

import { useState } from 'react';
import { mediforce } from '@/lib/mediforce';

type MemberRole = 'member' | 'admin';

export interface InviteResult {
  email: string;
  emailSent: boolean;
  isExisting: boolean;
}

interface InviteUserFormProps {
  handle: string;
  /** Shown to the invitee as who invited them. */
  inviterName: string | undefined;
  onInvited: (result: InviteResult) => void;
  onCancel: () => void;
}

export function InviteUserForm({ handle, inviterName, onInvited, onCancel }: InviteUserFormProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (trimmedEmail === '') {
      setError('Email is required.');
      return;
    }

    setInviting(true);
    try {
      const data = await mediforce.users.invite({
        email: trimmedEmail,
        displayName: name.trim() !== '' ? name.trim() : undefined,
        namespaceHandle: handle,
        role,
        inviterName,
      });

      onInvited({
        email: data.email,
        emailSent: data.emailSent,
        isExisting: data.isExisting,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setInviting(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border bg-card px-4 py-5">
      <h3 className="text-sm font-semibold mb-4">Invite user</h3>
      <form onSubmit={handleInvite} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="inviteEmail" className="text-sm font-medium">
            Email <span className="text-destructive">*</span>
          </label>
          <input
            id="inviteEmail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={inviting}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="inviteName" className="text-sm font-medium">
            Display name
          </label>
          <input
            id="inviteName"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Smith"
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={inviting}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="inviteRole" className="text-sm font-medium">
            Role
          </label>
          <select
            id="inviteRole"
            value={role}
            onChange={(e) => setRole(e.target.value as MemberRole)}
            className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
            disabled={inviting}
          >
            <option value="member">member</option>
            <option value="admin">admin</option>
          </select>
        </div>

        {error !== null && (
          <p className="text-xs text-destructive">{error}</p>
        )}

        <div className="flex items-center gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={inviting}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={inviting}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {inviting ? 'Sending…' : 'Send invite'}
          </button>
        </div>
      </form>
    </div>
  );
}
