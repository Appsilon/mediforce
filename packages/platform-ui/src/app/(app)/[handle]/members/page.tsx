'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  arrayRemove,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, Check, ClipboardCopy, Trash2, Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import { NamespaceMemberSchema } from '@mediforce/platform-core';
import type { NamespaceMember } from '@mediforce/platform-core';

type NamespaceMemberWithId = NamespaceMember & { id: string };

type MemberRole = 'member' | 'admin';

interface MemberWithLastSignIn extends NamespaceMemberWithId {
  email?: string | null;
  lastSignInTime?: string | null;
}

interface InviteResult {
  email: string;
  temporaryPassword: string;
  emailSent: boolean;
}

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatLastSignIn(isoString: string | null | undefined): string {
  if (isoString === null || isoString === undefined) return 'Never';
  const date = new Date(isoString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="h-3 w-3" /> : <ClipboardCopy className="h-3 w-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

export default function MembersPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');

  const { firebaseUser } = useAuth();
  const { namespace, loading: namespaceLoading } = useNamespace(handle);

  // Realtime Firestore subscription for role changes
  const [realtimeMembers, setRealtimeMembers] = useState<NamespaceMemberWithId[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  useEffect(() => {
    if (handle === '') return;
    const colRef = collection(db, `namespaces/${handle}/members`);
    const unsubscribe = onSnapshot(colRef, (snapshot) => {
      const docs = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }) as NamespaceMemberWithId)
        .filter((raw) => NamespaceMemberSchema.safeParse(raw).success);
      setRealtimeMembers(docs);
      setMembersLoading(false);
    }, () => {
      setMembersLoading(false);
    });
    return unsubscribe;
  }, [handle]);

  // API fetch for lastSignInTime + email
  const [lastSignInMap, setLastSignInMap] = useState<Map<string, string | null>>(new Map());
  const [emailMap, setEmailMap] = useState<Map<string, string | null>>(new Map());

  const fetchLastSignIn = useCallback(async () => {
    if (handle === '') return;
    const platformApiKey = process.env.NEXT_PUBLIC_PLATFORM_API_KEY ?? '';
    try {
      const res = await fetch(`/api/users/members?handle=${encodeURIComponent(handle)}`, {
        headers: { 'X-Api-Key': platformApiKey },
      });
      if (!res.ok) return;
      const data = (await res.json()) as { members: Array<{ uid: string; email: string | null; lastSignInTime: string | null }> };
      const map = new Map<string, string | null>();
      const emailMapLocal = new Map<string, string | null>();
      for (const member of data.members) {
        map.set(member.uid, member.lastSignInTime);
        emailMapLocal.set(member.uid, member.email);
      }
      setLastSignInMap(map);
      setEmailMap(emailMapLocal);
    } catch {
      // non-fatal — lastSignIn just won't show
    }
  }, [handle]);

  useEffect(() => {
    void fetchLastSignIn();
  }, [fetchLastSignIn]);

  // Merge realtime members with email + lastSignInTime from API
  const members = useMemo((): MemberWithLastSignIn[] => {
    return realtimeMembers
      .map((member) => ({
        ...member,
        email: emailMap.get(member.uid),
        lastSignInTime: lastSignInMap.get(member.uid),
      }))
      .sort((memberA, memberB) => {
        const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        return (roleOrder[memberA.role] ?? 3) - (roleOrder[memberB.role] ?? 3);
      });
  }, [realtimeMembers, lastSignInMap]);

  const currentUserMember = useMemo(
    () =>
      firebaseUser !== null
        ? members.find((member) => member.uid === firebaseUser.uid)
        : undefined,
    [members, firebaseUser],
  );

  const isOwner = currentUserMember?.role === 'owner';
  const canManageMembers =
    currentUserMember !== undefined &&
    (currentUserMember.role === 'owner' || currentUserMember.role === 'admin');

  // Invite form state
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const trimmedEmail = inviteEmail.trim().toLowerCase();
    if (trimmedEmail === '') {
      setError('Email is required.');
      return;
    }

    setInviting(true);
    try {
      const platformApiKey = process.env.NEXT_PUBLIC_PLATFORM_API_KEY ?? '';
      const res = await fetch('/api/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Api-Key': platformApiKey,
        },
        body: JSON.stringify({
          email: trimmedEmail,
          displayName: inviteName.trim() !== '' ? inviteName.trim() : undefined,
          namespaceHandle: handle,
          role: inviteRole,
        }),
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setError(data.error ?? 'Failed to send invite.');
        return;
      }

      const data = (await res.json()) as { uid: string; email: string; temporaryPassword: string; emailSent: boolean };
      setInviteResult({ email: data.email, temporaryPassword: data.temporaryPassword, emailSent: data.emailSent });
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('member');
      void fetchLastSignIn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setInviting(false);
    }
  }

  async function handleRemoveMember(memberUid: string) {
    try {
      await deleteDoc(doc(db, 'namespaces', handle, 'members', memberUid));
      await updateDoc(doc(db, 'users', memberUid), {
        organizations: arrayRemove(handle),
      });
    } catch {
      // silently fail — realtime subscription will reflect actual state
    }
  }

  async function handleToggleRole(memberUid: string, currentRole: string) {
    const nextRole = currentRole === 'admin' ? 'member' : 'admin';
    try {
      await updateDoc(doc(db, 'namespaces', handle, 'members', memberUid), { role: nextRole });
    } catch {
      // useCollection will reflect actual state
    }
  }

  const loading = namespaceLoading || membersLoading;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              href={`/${handle}`}
              className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Back"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div>
              <h1 className="text-xl font-semibold">Members</h1>
              {namespace !== null && namespace.type === 'organization' && (
                <p className="text-sm text-muted-foreground">
                  Manage who has access to this organization.
                </p>
              )}
            </div>
          </div>
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

        {/* Invite result card */}
        {inviteResult !== null && (
          <div className="mb-6 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-4">
            <div className="flex items-start gap-2">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
              <div className="space-y-1 min-w-0">
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Invite sent to {inviteResult.email}
                </p>
                <div className="text-sm text-green-700 dark:text-green-300 space-y-0.5">
                  <p>Login: <span className="font-mono">{inviteResult.email}</span></p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p>
                      Temporary password:{' '}
                      <span className="font-mono font-semibold">{inviteResult.temporaryPassword}</span>
                    </p>
                    <CopyButton text={inviteResult.temporaryPassword} />
                  </div>
                </div>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {inviteResult.emailSent
                    ? 'Email sent ✓'
                    : 'Email not sent — share credentials manually'}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Members table */}
        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="rounded-lg border bg-card px-4 py-4 animate-pulse flex gap-3"
              >
                <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
                <div className="space-y-2 flex-1">
                  <div className="h-4 w-36 rounded bg-muted" />
                  <div className="h-3 w-52 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        ) : members.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Users className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">No members yet.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            {/* Table header — hidden on mobile */}
            <div className="hidden sm:flex sm:items-center px-4 py-2 border-b bg-muted/50 gap-4">
              <span className="text-xs font-medium text-muted-foreground flex-1 min-w-0">User</span>
              <span className="text-xs font-medium text-muted-foreground w-16 shrink-0">Role</span>
              <span className="text-xs font-medium text-muted-foreground w-24 shrink-0">Joined</span>
              <span className="text-xs font-medium text-muted-foreground w-24 shrink-0">Last sign-in</span>
              <span className="sr-only w-8 shrink-0">Actions</span>
            </div>
            <div className="divide-y">
              {members.map((member) => {
                const name = member.displayName ?? member.uid;
                const avatar = member.avatarUrl;
                const initials = name.includes(' ')
                  ? `${name.split(' ')[0]?.[0] ?? ''}${name.split(' ')[1]?.[0] ?? ''}`.toUpperCase()
                  : name.slice(0, 2).toUpperCase();

                return (
                  <div
                    key={member.id}
                    className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4"
                  >
                    {/* User cell */}
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      {avatar !== undefined ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={avatar} alt={name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                          {initials}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{name}</p>
                        {member.email !== null && member.email !== undefined && (
                          <p className="text-xs text-muted-foreground truncate">{member.email}</p>
                        )}
                      </div>
                    </div>

                    {/* Role cell */}
                    <div className="sm:w-16 sm:shrink-0">
                      {isOwner && member.role !== 'owner' ? (
                        <button
                          type="button"
                          onClick={() => handleToggleRole(member.uid, member.role)}
                          title={`Click to change to ${member.role === 'admin' ? 'member' : 'admin'}`}
                          className="cursor-pointer"
                        >
                          <RoleBadge role={member.role} />
                        </button>
                      ) : (
                        <RoleBadge role={member.role} />
                      )}
                    </div>

                    {/* Joined cell */}
                    <div className="text-xs text-muted-foreground whitespace-nowrap sm:w-24 sm:shrink-0">
                      <span className="sm:hidden text-muted-foreground/70">Joined </span>
                      {formatDate(member.joinedAt)}
                    </div>

                    {/* Last sign-in cell */}
                    <div className="text-xs text-muted-foreground whitespace-nowrap sm:w-24 sm:shrink-0">
                      <span className="sm:hidden text-muted-foreground/70">Last sign-in: </span>
                      {formatLastSignIn(member.lastSignInTime)}
                    </div>

                    {/* Actions cell */}
                    <div className="flex justify-end sm:w-8 sm:shrink-0">
                      {canManageMembers && member.role !== 'owner' && member.uid !== firebaseUser?.uid ? (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(member.uid)}
                          className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                          aria-label={`Remove ${name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <div className="w-8" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Invite form */}
        {showInviteForm && canManageMembers && (
          <div className="mt-6 rounded-lg border bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-4">Invite user</h2>
            <form onSubmit={handleInvite} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="inviteEmail" className="text-sm font-medium">
                  Email <span className="text-destructive">*</span>
                </label>
                <input
                  id="inviteEmail"
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
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
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
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
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as MemberRole)}
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
                  onClick={() => { setShowInviteForm(false); setError(null); }}
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
        )}
      </div>
    </div>
  );
}
