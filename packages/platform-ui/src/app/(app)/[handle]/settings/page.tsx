'use client';

import { useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { arrayRemove, collection, deleteDoc, doc, getDocs, updateDoc, writeBatch } from 'firebase/firestore';
import Link from 'next/link';
import { ArrowLeft, LogOut, Trash2 } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useCollection } from '@/hooks/use-collection';
import { useNamespace } from '@/hooks/use-namespace';
import { NamespaceMemberSchema } from '@mediforce/platform-core';
import type { NamespaceMember } from '@mediforce/platform-core';

type NamespaceMemberWithId = NamespaceMember & { id: string };

export default function OrgSettingsPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const router = useRouter();

  const { firebaseUser } = useAuth();
  const { namespace, loading: namespaceLoading } = useNamespace(handle);

  const collectionPath = handle !== '' ? `namespaces/${handle}/members` : '';
  const { data: rawMembers, loading: membersLoading } = useCollection<NamespaceMemberWithId>(collectionPath);

  const currentUserMember = useMemo(() => {
    if (firebaseUser === null) return undefined;
    return rawMembers
      .filter((m) => NamespaceMemberSchema.safeParse(m).success)
      .find((m) => m.uid === firebaseUser.uid);
  }, [rawMembers, firebaseUser]);

  const isOwner = currentUserMember?.role === 'owner';
  const isMember = currentUserMember !== undefined;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [leaving, setLeaving] = useState(false);

  async function handleDeleteOrg() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }

    setDeleting(true);
    try {
      const membersSnapshot = await getDocs(collection(db, 'namespaces', handle, 'members'));
      const batch = writeBatch(db);

      for (const memberDoc of membersSnapshot.docs) {
        batch.delete(memberDoc.ref);
      }
      batch.delete(doc(db, 'namespaces', handle));
      await batch.commit();

      await Promise.all(
        membersSnapshot.docs.map((memberDoc) =>
          updateDoc(doc(db, 'users', memberDoc.id), {
            organizations: arrayRemove(handle),
          }),
        ),
      );

      router.push(`/${handle}/workflows`);
    } catch {
      setDeleting(false);
    }
  }

  async function handleLeaveOrg() {
    if (firebaseUser === null) return;
    setLeaving(true);
    try {
      await deleteDoc(doc(db, 'namespaces', handle, 'members', firebaseUser.uid));
      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        organizations: arrayRemove(handle),
      });
      router.push(`/${handle}/workflows`);
    } catch {
      setLeaving(false);
    }
  }

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
        <h1 className="text-xl font-semibold">Organization not found</h1>
      </div>
    );
  }

  if (!isMember) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <p className="text-sm text-muted-foreground">You are not a member of this organization.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8">
          <Link
            href={`/${handle}`}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            @{handle}
          </Link>
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage organization settings for <span className="font-semibold">@{handle}</span>.
          </p>
        </div>

        {!isOwner && (
          <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-1">Leave organization</h2>
            <p className="text-xs text-muted-foreground mb-3">
              You will lose access to this organization&apos;s resources.
            </p>
            <button
              type="button"
              onClick={handleLeaveOrg}
              disabled={leaving}
              className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
            >
              <LogOut className="h-3.5 w-3.5" />
              {leaving ? 'Leaving…' : 'Leave organization'}
            </button>
          </div>
        )}

        {isOwner && (
          <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
            <h2 className="text-sm font-semibold mb-1 text-destructive">Delete organization</h2>
            <p className="text-xs text-muted-foreground mb-3">
              This will permanently delete <span className="font-semibold">@{handle}</span>, remove all members, and cannot be undone.
            </p>
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDeleteOrg}
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
                onClick={handleDeleteOrg}
                className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete organization
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
