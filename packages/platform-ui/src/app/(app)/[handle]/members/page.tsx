'use client';

import { useState, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where, type DocumentReference } from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, Trash2, Users } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useCollection } from '@/hooks/use-collection';
import { useNamespace } from '@/hooks/use-namespace';
import { useUserProfiles } from '@/hooks/use-users';
import { NamespaceMemberSchema } from '@mediforce/platform-core';
import type { NamespaceMember } from '@mediforce/platform-core';

type NamespaceMemberWithId = NamespaceMember & { id: string };

type MemberRole = 'member' | 'admin';

function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
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

export default function MembersPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');

  const { firebaseUser } = useAuth();
  const { namespace, loading: namespaceLoading } = useNamespace(handle);

  const userProfiles = useUserProfiles();
  const collectionPath = handle !== '' ? `namespaces/${handle}/members` : '';
  const { data: rawMembers, loading: membersLoading } = useCollection<NamespaceMemberWithId>(
    collectionPath,
  );

  const members = useMemo((): NamespaceMemberWithId[] => {
    return rawMembers
      .filter((rawMember) => NamespaceMemberSchema.safeParse(rawMember).success)
      .sort((memberA, memberB) => {
        const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        return (roleOrder[memberA.role] ?? 3) - (roleOrder[memberB.role] ?? 3);
      });
  }, [rawMembers]);

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

  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<MemberRole>('member');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function handleAddMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAddError(null);

    const trimmedEmail = newEmail.trim().toLowerCase();
    if (trimmedEmail === '') {
      setAddError('Email is required.');
      return;
    }

    setAdding(true);

    try {
      const usersQuery = query(collection(db, 'users'), where('email', '==', trimmedEmail));
      const usersSnapshot = await getDocs(usersQuery);

      if (usersSnapshot.empty) {
        setAddError('No user found with this email. They need to sign in at least once first.');
        setAdding(false);
        return;
      }

      const userDoc = usersSnapshot.docs[0];
      const uid = userDoc.id;
      const userData = userDoc.data();

      const existingMember = members.find((member) => member.uid === uid);
      if (existingMember !== undefined) {
        setAddError('This user is already a member.');
        setAdding(false);
        return;
      }

      await setDoc(doc(db, 'namespaces', handle, 'members', uid), {
        uid,
        role: newRole,
        ...(typeof userData.displayName === 'string' ? { displayName: userData.displayName } : {}),
        ...(typeof userData.photoURL === 'string' ? { avatarUrl: userData.photoURL } : {}),
        joinedAt: new Date().toISOString(),
      });

      await updateDoc(doc(db, 'users', uid), {
        organizations: arrayUnion(handle),
      });

      setNewEmail('');
      setNewRole('member');
    } catch (err: unknown) {
      setAddError(err instanceof Error ? err.message : 'Failed to add member.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveMember(memberUid: string) {
    try {
      await deleteDoc(doc(db, 'namespaces', handle, 'members', memberUid));
      await updateDoc(doc(db, 'users', memberUid), {
        organizations: arrayRemove(handle),
      });
    } catch {
      // silently fail — useCollection will update the list
    }
  }

  async function handleToggleRole(memberUid: string, currentRole: string) {
    const newRole = currentRole === 'admin' ? 'member' : 'admin';
    try {
      await updateDoc(doc(db, 'namespaces', handle, 'members', memberUid), { role: newRole });
    } catch {
      // useCollection will reflect actual state
    }
  }

  const loading = namespaceLoading || membersLoading;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8">
          <Link
            href={`/${handle}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            @{handle}
          </Link>
          <h1 className="text-xl font-semibold">Members</h1>
          {namespace !== null && namespace.type === 'organization' && (
            <p className="text-sm text-muted-foreground mt-1">
              Manage who has access to this organization.
            </p>
          )}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((index) => (
              <div
                key={index}
                className="rounded-lg border bg-card px-4 py-4 animate-pulse flex gap-3"
              >
                <div className="h-7 w-7 rounded-full bg-muted shrink-0" />
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
          <div className="space-y-2">
            {members.map((member) => {
              const profile = userProfiles.get(member.uid);
              const name = member.displayName ?? profile?.displayName ?? member.uid;
              const avatar = member.avatarUrl ?? profile?.photoURL;
              return (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3"
              >
                {avatar !== undefined ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={avatar} alt={name} className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold">
                    {name.includes(' ')
                      ? `${name.split(' ')[0]?.[0] ?? ''}${name.split(' ')[1]?.[0] ?? ''}`.toUpperCase()
                      : name.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate">{name}</span>
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
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Joined {formatDate(member.joinedAt)}
                  </p>
                </div>
                {canManageMembers && member.role !== 'owner' && member.uid !== firebaseUser?.uid && (
                  <button
                    type="button"
                    onClick={() => handleRemoveMember(member.uid)}
                    className="shrink-0 rounded p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    aria-label={`Remove ${name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              );
            })}
          </div>
        )}

        {canManageMembers && (
          <div className="mt-8 rounded-lg border bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-4">Add member</h2>
            <form onSubmit={handleAddMember} className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="newEmail" className="text-sm font-medium">
                  Email
                </label>
                <input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="colleague@example.com"
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  disabled={adding}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="newRole" className="text-sm font-medium">
                  Role
                </label>
                <select
                  id="newRole"
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value as MemberRole)}
                  className="rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                  disabled={adding}
                >
                  <option value="member">member</option>
                  <option value="admin">admin</option>
                </select>
              </div>

              {addError !== null && (
                <p className="text-xs text-destructive">{addError}</p>
              )}

              <div>
                <button
                  type="submit"
                  disabled={adding}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  {adding ? 'Adding…' : 'Add member'}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
