'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { collection, doc, getDoc, getDocs, query, orderBy, limit, updateDoc } from 'firebase/firestore';
import * as Tooltip from '@radix-ui/react-tooltip';
import { Pencil, Check, X } from 'lucide-react';
import { db } from '@/lib/firebase';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import { useUserDisplayNames } from '@/hooks/use-users';
import type { Namespace } from '@mediforce/platform-core';

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

type MemberPreview = {
  uid: string;
  displayName?: string;
  avatarUrl?: string;
  role: string;
  joinedAt: string;
};

const MAX_AVATAR_MEMBERS = 20;

function useOrgMembers(handle: string, enabled: boolean) {
  const [members, setMembers] = React.useState<MemberPreview[]>([]);
  const [totalCount, setTotalCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (!enabled || !handle) return;

    const membersRef = collection(db, 'namespaces', handle, 'members');
    const previewQuery = query(membersRef, orderBy('joinedAt', 'asc'), limit(MAX_AVATAR_MEMBERS));

    Promise.all([getDocs(previewQuery), getDocs(membersRef)])
      .then(([previewSnapshot, fullSnapshot]) => {
        const roleOrder: Record<string, number> = { owner: 0, admin: 1, member: 2 };
        const previews = previewSnapshot.docs
          .map((docSnap) => {
            const data = docSnap.data();
            return {
              uid: docSnap.id,
              displayName: typeof data.displayName === 'string' ? data.displayName : undefined,
              avatarUrl: typeof data.avatarUrl === 'string' ? data.avatarUrl : undefined,
              role: typeof data.role === 'string' ? data.role : 'member',
              joinedAt: typeof data.joinedAt === 'string' ? data.joinedAt : '',
            };
          })
          .sort((a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3));
        setMembers(previews);
        setTotalCount(fullSnapshot.size);
      })
      .catch(() => {
        setMembers([]);
        setTotalCount(null);
      });
  }, [handle, enabled]);

  return { members, totalCount };
}

function useCurrentUserRole(handle: string, uid: string | undefined): string | null {
  const [role, setRole] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!handle || uid === undefined) {
      setRole(null);
      return;
    }
    getDoc(doc(db, 'namespaces', handle, 'members', uid))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setRole(typeof data.role === 'string' ? data.role : null);
        } else {
          setRole(null);
        }
      })
      .catch(() => setRole(null));
  }, [handle, uid]);

  return role;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function InitialsAvatar({ displayName }: { displayName: string }) {
  const initials = displayName
    .split(' ')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');

  return (
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-primary text-2xl font-semibold shrink-0">
      {initials}
    </div>
  );
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const ROLE_LABELS: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

function MemberTooltipAvatar({ member, resolvedName }: { member: MemberPreview; resolvedName: string }) {
  const parts = resolvedName.split(' ');
  const initials = parts.length >= 2
    ? `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase()
    : resolvedName.slice(0, 2).toUpperCase();

  return (
    <Tooltip.Root delayDuration={200}>
      <Tooltip.Trigger asChild>
        {member.avatarUrl !== undefined ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={member.avatarUrl}
            alt={resolvedName}
            className="h-7 w-7 rounded-full border-2 border-background object-cover cursor-pointer"
          />
        ) : (
          <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-primary/10 text-primary text-[10px] font-semibold cursor-pointer">
            {initials}
          </div>
        )}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          className="z-50 rounded-lg border bg-popover px-3 py-2 shadow-md animate-in fade-in-0 zoom-in-95"
        >
          <p className="text-sm font-medium">{resolvedName}</p>
          <p className="text-xs text-muted-foreground">
            {ROLE_LABELS[member.role] ?? member.role}
            {member.joinedAt !== '' && <> &middot; Joined {formatDate(member.joinedAt)}</>}
          </p>
          <Tooltip.Arrow className="fill-popover" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

function MemberAvatars({ namespace }: { namespace: Namespace }) {
  const { members, totalCount } = useOrgMembers(
    namespace.handle,
    namespace.type === 'organization',
  );
  const displayNames = useUserDisplayNames();

  if (namespace.type !== 'organization') return null;
  if (totalCount === null) return null;

  function resolveName(member: MemberPreview): string {
    return member.displayName ?? displayNames.get(member.uid) ?? member.uid;
  }

  return (
    <div className="mt-4">
      <Link
        href={`/${namespace.handle}/members`}
        className="group inline-flex items-center gap-2.5"
      >
        {members.length > 0 && (
          <Tooltip.Provider>
            <div className="flex -space-x-2" onClick={(e) => e.stopPropagation()}>
              {members.map((member) => (
                <MemberTooltipAvatar key={member.uid} member={member} resolvedName={resolveName(member)} />
              ))}
            </div>
          </Tooltip.Provider>
        )}
        <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">
          {totalCount} {totalCount === 1 ? 'member' : 'members'}
        </span>
      </Link>
    </div>
  );
}

function InlineEditableBio({
  namespace,
  canEdit,
}: {
  namespace: Namespace;
  canEdit: boolean;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(namespace.bio ?? '');
  const [saving, setSaving] = React.useState(false);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  React.useEffect(() => {
    if (editing && textareaRef.current !== null) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [editing]);

  async function handleSave() {
    setSaving(true);
    try {
      const trimmed = value.trim();
      await updateDoc(doc(db, 'namespaces', namespace.handle), {
        bio: trimmed !== '' ? trimmed : null,
      });
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    setValue(namespace.bio ?? '');
    setEditing(false);
  }

  function handleKeyDown(event: React.KeyboardEvent) {
    if (event.key === 'Escape') {
      handleCancel();
    }
    if (event.key === 'Enter' && event.metaKey) {
      handleSave();
    }
  }

  const hasBio = namespace.bio !== undefined && namespace.bio !== '';

  if (editing) {
    return (
      <div className="mt-3">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          maxLength={280}
          rows={3}
          disabled={saving}
          className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none disabled:opacity-50"
          placeholder="Describe this organization…"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Check className="h-3 w-3" />
            {saving ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={handleCancel}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-accent transition-colors"
          >
            <X className="h-3 w-3" />
            Cancel
          </button>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {value.length}/280 &middot; <kbd className="font-mono">⌘Enter</kbd> to save
          </span>
        </div>
      </div>
    );
  }

  if (!hasBio && canEdit) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="mt-3 text-sm text-muted-foreground hover:text-foreground transition-colors italic"
      >
        Add a description…
      </button>
    );
  }

  if (!hasBio) return null;

  return (
    <div className="group/bio mt-3 flex items-start gap-1.5">
      <p className="text-sm text-foreground flex-1">{namespace.bio}</p>
      {canEdit && (
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded p-1 text-muted-foreground opacity-0 group-hover/bio:opacity-100 hover:bg-accent transition-all"
          aria-label="Edit description"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ProfilePage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : rawHandle;

  const { firebaseUser } = useAuth();
  const { namespace, loading, error } = useNamespace(handle ?? '');
  const currentRole = useCurrentUserRole(handle ?? '', firebaseUser?.uid);
  const canEdit = currentRole === 'owner' || currentRole === 'admin';

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="text-sm text-muted-foreground animate-pulse">Loading…</div>
      </div>
    );
  }

  if (error !== null || namespace === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <span className="text-2xl text-muted-foreground">?</span>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-semibold">Profile not found</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {handle !== undefined && handle !== '' ? (
              <>No profile exists for <span className="font-mono">@{handle}</span>.</>
            ) : (
              'The requested profile does not exist.'
            )}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-start gap-5">
          {namespace.avatarUrl !== undefined && namespace.avatarUrl !== '' ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={namespace.avatarUrl}
              alt={namespace.displayName}
              className="h-20 w-20 rounded-full object-cover shrink-0"
            />
          ) : (
            <InitialsAvatar displayName={namespace.displayName} />
          )}

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-semibold">{namespace.displayName}</h1>
              <span
                className={[
                  'rounded-full px-2 py-0.5 text-[11px] font-medium',
                  namespace.type === 'organization'
                    ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                    : 'bg-muted text-muted-foreground',
                ].join(' ')}
              >
                {namespace.type === 'organization' ? 'Organization' : 'Personal'}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mt-0.5">@{namespace.handle}</p>

            <InlineEditableBio namespace={namespace} canEdit={canEdit} />

            <MemberAvatars namespace={namespace} />
          </div>
        </div>
      </div>
    </div>
  );
}
