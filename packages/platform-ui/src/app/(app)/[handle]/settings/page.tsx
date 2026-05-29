'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import * as Switch from '@radix-ui/react-switch';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Check,
  ClipboardCopy,
  LogOut,
  MailIcon,
  Trash2,
  Users,
} from 'lucide-react';
import { ApiError, mediforce } from '@/lib/mediforce';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import {
  useDeleteNamespace,
  useLeaveNamespace,
  useRemoveMember,
  useUpdateMemberRole,
  useUpdateNamespace,
} from '@/hooks/use-namespace-mutations';
import { WORKSPACE_ICONS, WORKSPACE_ICON_KEYS, getWorkspaceIcon, WORKSPACE_DEFAULT_KEY } from '@/lib/workspace-icons';
import type { NamespaceMember } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { NamespaceSecretsEditor } from '@/components/namespace/namespace-secrets-editor';

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
  isExisting: boolean;
}

interface ResendResult {
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

function DefaultWorkspaceSection({ handle }: { handle: string }) {
  const [isDefault, setIsDefault] = useState(false);

  useEffect(() => {
    setIsDefault(localStorage.getItem(WORKSPACE_DEFAULT_KEY) === handle);
  }, [handle]);

  function handleToggle(checked: boolean) {
    if (checked) {
      localStorage.setItem(WORKSPACE_DEFAULT_KEY, handle);
    } else {
      localStorage.removeItem(WORKSPACE_DEFAULT_KEY);
    }
    setIsDefault(checked);
  }

  return (
    <div className="mb-10 space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preferences</h2>
      <div className="rounded-lg border bg-card px-4 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Default workspace</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Open this workspace automatically when you sign in.
            </p>
          </div>
          <Switch.Root
            checked={isDefault}
            onCheckedChange={handleToggle}
            className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=checked]:bg-primary"
            aria-label="Set as default workspace"
          >
            <Switch.Thumb className="pointer-events-none block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
          </Switch.Root>
        </div>
      </div>
    </div>
  );
}

export default function WorkspaceConfigPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();
  const qc = useQueryClient();

  const { firebaseUser } = useAuth();
  const { namespace, loading: namespaceLoading } = useNamespace(handle);

  // Polled members list via the headless contract — replaces the previous
  // `onSnapshot(namespaces/{handle}/members)` subscription. Realtime updates
  // become a small staleness window (next listMembers tick after a mutation);
  // §"Phase 4 is a swap, not a redesign" accepts this regression.
  const [realtimeMembers, setRealtimeMembers] = useState<NamespaceMemberWithId[]>([]);
  const [membersLoading, setMembersLoading] = useState(true);

  const refreshMembers = useCallback(async () => {
    if (handle === '') return;
    try {
      const { members: fetched } = await mediforce.users.listMembers({ namespace: handle });
      setRealtimeMembers(
        fetched.map((m) => ({ ...m, displayName: m.displayName ?? undefined, id: m.uid })),
      );
    } finally {
      setMembersLoading(false);
    }
  }, [handle]);

  useEffect(() => {
    void refreshMembers();
  }, [refreshMembers]);

  // API fetch for lastSignInTime + email + auth-enriched displayName.
  // Owner member docs created before the createNamespace handler started
  // persisting displayName lack it locally; the listMembers handler falls
  // back to the Firebase Auth profile name, and we merge that override
  // here so legacy workspaces show a human name instead of the uid.
  const [lastSignInMap, setLastSignInMap] = useState<Map<string, string | null>>(new Map());
  const [emailMap, setEmailMap] = useState<Map<string, string | null>>(new Map());
  const [displayNameMap, setDisplayNameMap] = useState<Map<string, string | null>>(new Map());

  const fetchLastSignIn = useCallback(async () => {
    if (handle === '' || firebaseUser === null) return;
    try {
      const { members } = await mediforce.users.listMembers({ namespace: handle });
      const map = new Map<string, string | null>();
      const emailMapLocal = new Map<string, string | null>();
      const displayNameMapLocal = new Map<string, string | null>();
      for (const member of members) {
        map.set(member.uid, member.lastSignInTime);
        emailMapLocal.set(member.uid, member.email);
        displayNameMapLocal.set(member.uid, member.displayName);
      }
      setLastSignInMap(map);
      setEmailMap(emailMapLocal);
      setDisplayNameMap(displayNameMapLocal);
    } catch {
      // non-fatal — lastSignIn just won't show
    }
  }, [handle, firebaseUser]);

  useEffect(() => {
    void fetchLastSignIn();
  }, [fetchLastSignIn]);

  // Merge realtime members with enriched displayName + email + lastSignInTime
  const members = useMemo((): MemberWithLastSignIn[] => {
    return realtimeMembers
      .map((member) => {
        const enrichedDisplayName = displayNameMap.get(member.uid);
        return {
          ...member,
          displayName: enrichedDisplayName !== undefined && enrichedDisplayName !== null
            ? enrichedDisplayName
            : member.displayName,
          email: emailMap.get(member.uid),
          lastSignInTime: lastSignInMap.get(member.uid),
        };
      })
      .sort((memberA, memberB) => {
        const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        return (roleOrder[memberA.role] ?? 3) - (roleOrder[memberB.role] ?? 3);
      });
  }, [realtimeMembers, lastSignInMap, emailMap, displayNameMap]);

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

  // Personal namespaces have no member docs — ownership is via linkedUserId
  const isPersonalOwner =
    namespace !== null &&
    namespace.type === 'personal' &&
    namespace.linkedUserId === firebaseUser?.uid;

  const canEditProfile = canManageMembers || isPersonalOwner;

  // ── Workspace profile editing ──────────────────────────────────────────────
  const [profileDisplayName, setProfileDisplayName] = useState('');
  const [profileBio, setProfileBio] = useState('');
  const [profileIcon, setProfileIcon] = useState('Building2');
  const [profileSaved, setProfileSaved] = useState(false);
  const updateNamespace = useUpdateNamespace(handle);
  const savingProfile = updateNamespace.isPending;

  // Initialise form fields from namespace once loaded
  useEffect(() => {
    if (namespace !== null) {
      setProfileDisplayName(namespace.displayName);
      setProfileBio(namespace.bio ?? '');
      setProfileIcon(namespace.icon ?? 'Building2');
    }
  }, [namespace]);

  async function handleSaveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = profileDisplayName.trim();
    if (trimmedName === '') return;
    const trimmedBio = profileBio.trim();
    try {
      await updateNamespace.mutateAsync({
        handle,
        displayName: trimmedName,
        bio: trimmedBio,
      });
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2500);
    } catch {
      // Optimistic snapshot already restored by the hook; nothing to do.
    }
  }

  // ── Icon picker ────────────────────────────────────────────────────────────
  async function handleIconChange(iconKey: string) {
    setProfileIcon(iconKey);
    try {
      await updateNamespace.mutateAsync({ handle, icon: iconKey });
    } catch {
      setProfileIcon(namespace?.icon ?? 'Building2');
    }
  }

  // ── Invite form state ──────────────────────────────────────────────────────
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('member');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resendingUid, setResendingUid] = useState<string | null>(null);
  const [resendResult, setResendResult] = useState<ResendResult | null>(null);

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
      const data = await mediforce.users.invite({
        email: trimmedEmail,
        displayName: inviteName.trim() !== '' ? inviteName.trim() : undefined,
        namespaceHandle: handle,
        role: inviteRole,
        inviterName: firebaseUser?.displayName ?? firebaseUser?.email ?? undefined,
      });

      setInviteResult({
        email: data.email,
        temporaryPassword: data.temporaryPassword,
        emailSent: data.emailSent,
        isExisting: data.isExisting,
      });
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteName('');
      setInviteRole('member');
      // Refresh the members list — PR4 swapped the previous onSnapshot
      // subscription for `useNamespace` react-query, so the cache needs an
      // explicit invalidation now that the invite mutation isn't a hook.
      await qc.invalidateQueries({ queryKey: queryKeys.namespace(handle) });
      void fetchLastSignIn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to send invite.');
    } finally {
      setInviting(false);
    }
  }

  async function handleResendInvite(memberUid: string) {
    setResendResult(null);
    setResendingUid(memberUid);
    try {
      const data = await mediforce.users.resendInvite({
        uid: memberUid,
        namespaceHandle: handle,
      });
      setResendResult({
        email: data.email,
        temporaryPassword: data.temporaryPassword,
        emailSent: data.emailSent,
      });
      void fetchLastSignIn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resend invite.');
    } finally {
      setResendingUid(null);
    }
  }

  const removeMember = useRemoveMember(handle);
  const updateMemberRole = useUpdateMemberRole(handle);
  const leaveNamespace = useLeaveNamespace();
  const deleteNamespace = useDeleteNamespace();

  // Surface fail-cases for every workspace-altering action via one banner —
  // member removal, role flips, leave, delete. Optimistic snapshot rollback
  // hides the underlying error; without this banner an admin would see the
  // role un-flip and not know why.
  const [dangerError, setDangerError] = useState<string | null>(null);

  async function handleRemoveMember(memberUid: string) {
    setDangerError(null);
    try {
      await removeMember.mutateAsync({ handle, uid: memberUid });
      void refreshMembers();
    } catch (err: unknown) {
      setDangerError(err instanceof Error ? err.message : 'Failed to remove member.');
    }
  }

  async function handleToggleRole(memberUid: string, currentRole: string) {
    setDangerError(null);
    const nextRole: 'admin' | 'member' = currentRole === 'admin' ? 'member' : 'admin';
    try {
      await updateMemberRole.mutateAsync({ handle, uid: memberUid, role: nextRole });
      void refreshMembers();
    } catch (err: unknown) {
      setDangerError(err instanceof Error ? err.message : 'Failed to update member role.');
    }
  }

  // ── Danger zone ────────────────────────────────────────────────────────────
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDeleteWorkspace() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDangerError(null);
    try {
      await deleteNamespace.mutateAsync({ handle });
      router.push('/workspace-selection');
    } catch (err: unknown) {
      setDangerError(err instanceof Error ? err.message : 'Failed to delete workspace.');
    }
  }

  async function handleLeaveWorkspace() {
    if (firebaseUser === null) return;
    setDangerError(null);
    try {
      await leaveNamespace.mutateAsync({ handle });
      router.push('/workspace-selection');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'precondition_failed') {
        setDangerError(err.message);
        return;
      }
      setDangerError(err instanceof Error ? err.message : 'Failed to leave workspace.');
    }
  }

  const deleting = deleteNamespace.isPending;
  const leaving = leaveNamespace.isPending;

  const loading = namespaceLoading || membersLoading;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (namespace === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <h1 className="text-xl font-semibold">Workspace not found</h1>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8 flex items-center gap-3">
          <Link
            href={`/${handle}`}
            className="rounded p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold">Workspace settings</h1>
            <p className="text-sm text-muted-foreground">@{handle}</p>
          </div>
        </div>

        {/* ── Section 1: Workspace profile ─────────────────────────────────── */}
        {canEditProfile && (
          <div className="mb-10 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Profile</h2>

            {/* Name + bio form */}
            <div className="rounded-lg border bg-card px-4 py-5">
              <form onSubmit={handleSaveProfile} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="workspaceName" className="text-sm font-medium">
                    Workspace name
                  </label>
                  <input
                    id="workspaceName"
                    type="text"
                    value={profileDisplayName}
                    onChange={(e) => setProfileDisplayName(e.target.value)}
                    placeholder="My workspace"
                    className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                    disabled={savingProfile}
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label htmlFor="workspaceBio" className="text-sm font-medium">
                    Description
                  </label>
                  <textarea
                    id="workspaceBio"
                    value={profileBio}
                    onChange={(e) => setProfileBio(e.target.value)}
                    placeholder="What is this workspace used for?"
                    rows={3}
                    className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 resize-none"
                    disabled={savingProfile}
                  />
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={savingProfile || profileDisplayName.trim() === ''}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                  >
                    {savingProfile ? 'Saving…' : 'Save changes'}
                  </button>
                  {profileSaved && (
                    <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                      <Check className="h-3 w-3" />
                      Saved
                    </span>
                  )}
                </div>
              </form>
            </div>

            {/* Icon picker */}
            {namespace.type === 'organization' && (
              <div className="rounded-lg border bg-card px-4 py-5">
                <h3 className="text-sm font-semibold mb-4">Workspace icon</h3>
                <div className="flex items-center gap-6">
                  {/* Preview */}
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                    {(() => {
                      const Icon = getWorkspaceIcon(profileIcon);
                      return <Icon className="h-7 w-7 text-primary" />;
                    })()}
                  </div>
                  {/* Grid */}
                  <div className="grid grid-cols-5 gap-1.5">
                    {WORKSPACE_ICON_KEYS.map((key) => {
                      const Icon = WORKSPACE_ICONS[key]!;
                      return (
                        <button
                          key={key}
                          type="button"
                          title={key}
                          onClick={() => handleIconChange(key)}
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-lg border-2 transition-colors',
                            profileIcon === key
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-transparent bg-muted text-muted-foreground hover:border-border hover:text-foreground',
                          )}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 2: Default workspace ─────────────────────────────────── */}
        <DefaultWorkspaceSection handle={handle} />

        {/* ── Section 3: Members ────────────────────────────────────────────── */}
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
                  <div className="text-sm text-blue-700 dark:text-blue-300 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p>
                        New temporary password:{' '}
                        <span className="font-mono font-semibold">{resendResult.temporaryPassword}</span>
                      </p>
                      <CopyButton text={resendResult.temporaryPassword} />
                    </div>
                  </div>
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    {resendResult.emailSent
                      ? 'Email sent ✓'
                      : 'Email not sent — share credentials manually'}
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

          {/* Invite result card */}
          {inviteResult !== null && (
            <div className="mb-4 rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 px-4 py-4">
              <div className="flex items-start gap-2">
                <Check className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />
                <div className="space-y-1 min-w-0">
                  <p className="text-sm font-medium text-green-800 dark:text-green-200">
                    {inviteResult.isExisting
                      ? `${inviteResult.email} added to workspace`
                      : `Invite sent to ${inviteResult.email}`}
                  </p>
                  {!inviteResult.isExisting && (
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
                  )}
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {inviteResult.emailSent
                      ? 'Email sent ✓'
                      : inviteResult.isExisting
                        ? 'Email not sent'
                        : 'Email not sent — share credentials manually'}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Members table */}
          {membersLoading ? (
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
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Users className="h-6 w-6 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">No members yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">User</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Email</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Role</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Joined</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Last sign in</th>
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

                    return (
                      <tr key={member.id} className="hover:bg-muted/30 transition-colors">
                        {/* User */}
                        <td className="px-4 py-3 whitespace-nowrap">
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
                        </td>

                        {/* Email */}
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {member.email ?? '—'}
                        </td>

                        {/* Role */}
                        <td className="px-4 py-3 whitespace-nowrap">
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
                        </td>

                        {/* Joined */}
                        <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(member.joinedAt)}
                        </td>

                        {/* Last sign in */}
                        <td className="px-4 py-3 whitespace-nowrap text-xs text-muted-foreground">
                          {member.lastSignInTime === null || member.lastSignInTime === undefined
                            ? <span className="text-muted-foreground/50">Never</span>
                            : formatLastSignIn(member.lastSignInTime)}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex items-center justify-end gap-1">
                            {canManageMembers && member.role !== 'owner' && member.uid !== firebaseUser?.uid ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleResendInvite(member.uid)}
                                  disabled={resendingUid === member.uid}
                                  title="Resend invite"
                                  className="rounded p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors disabled:opacity-40"
                                  aria-label={`Resend invite to ${name}`}
                                >
                                  <MailIcon className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoveMember(member.uid)}
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
          )}

          {/* Invite form */}
          {showInviteForm && canManageMembers && (
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

        {/* ── Section 4: Workspace Secrets ──────────────────────────────── */}
        {canEditProfile && firebaseUser?.uid && (
          <div className="mb-10 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Workspace Secrets</h2>
            <div className="rounded-lg border bg-card px-4 py-5">
              <NamespaceSecretsEditor namespace={handle} userId={firebaseUser.uid} />
            </div>
          </div>
        )}

        {/* ── Section 5: Administration ──────────────────────────────────── */}
        {canEditProfile && (
          <div className="mb-10 space-y-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Administration</h2>
            <div className="rounded-lg border bg-card px-4 py-5 space-y-3">
              <Link
                href={`/${handle}/admin/infrastructure`}
                className="flex items-center justify-between group"
              >
                <div>
                  <p className="text-sm font-medium group-hover:text-primary transition-colors">Infrastructure</p>
                  <p className="text-xs text-muted-foreground">Docker images and disk usage</p>
                </div>
                <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 group-hover:text-primary transition-colors" />
              </Link>
              <div className="border-t" />
              <Link
                href={`/${handle}/admin/tool-catalog`}
                className="flex items-center justify-between group"
              >
                <div>
                  <p className="text-sm font-medium group-hover:text-primary transition-colors">Tool catalog</p>
                  <p className="text-xs text-muted-foreground">MCP servers available to agents</p>
                </div>
                <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 group-hover:text-primary transition-colors" />
              </Link>
              <div className="border-t" />
              <Link
                href={`/${handle}/admin/oauth-providers`}
                className="flex items-center justify-between group"
              >
                <div>
                  <p className="text-sm font-medium group-hover:text-primary transition-colors">OAuth providers</p>
                  <p className="text-xs text-muted-foreground">External authentication for MCP tools</p>
                </div>
                <ArrowLeft className="h-4 w-4 text-muted-foreground rotate-180 group-hover:text-primary transition-colors" />
              </Link>
            </div>
          </div>
        )}

        {/* ── Danger zone ───────────────────────────────────────────────────── */}
        {dangerError !== null && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {dangerError}
          </div>
        )}

        {!isOwner && currentUserMember !== undefined && (
          <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-1">Leave workspace</h2>
            <p className="text-xs text-muted-foreground mb-3">
              You will lose access to this workspace&apos;s resources.
            </p>
            <button
              type="button"
              onClick={handleLeaveWorkspace}
              disabled={leaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              {leaving ? 'Leaving…' : 'Leave workspace'}
            </button>
          </div>
        )}

        {isOwner && (
          <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-1 text-destructive">Delete workspace</h2>
            <p className="text-xs text-muted-foreground mb-3">
              This will permanently delete <span className="font-semibold">@{handle}</span>, remove all members, and cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteWorkspace}
                  disabled={deleting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Deleting…' : 'Yes, delete permanently'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={deleting}
                  className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleDeleteWorkspace}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete workspace
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
