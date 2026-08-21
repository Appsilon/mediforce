'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { useNamespace } from '@/hooks/use-namespace';
import { useNamespaceMembers } from '@/hooks/use-namespace-members';
import { DefaultWorkspaceSection } from '@/components/namespace/settings/default-workspace-section';
import { WorkspaceAdministrationSection } from '@/components/namespace/settings/workspace-administration-section';
import { WorkspaceDangerZone } from '@/components/namespace/settings/workspace-danger-zone';
import { WorkspaceMembersSection } from '@/components/namespace/settings/workspace-members-section';
import { WorkspaceProfileSection } from '@/components/namespace/settings/workspace-profile-section';
import { WorkspaceSecretsSection } from '@/components/namespace/settings/workspace-secrets-section';

export default function WorkspaceConfigPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');

  const { user } = useAuth();
  const { namespace, personalHandles, loading: namespaceLoading } = useNamespace(handle);
  const { members, loading: membersLoading } = useNamespaceMembers(handle);

  const currentUserMember = useMemo(
    () =>
      user !== null
        ? members.find((member) => member.uid === user.id)
        : undefined,
    [members, user],
  );

  const isOwner = currentUserMember?.role === 'owner';
  const canManageMembers =
    currentUserMember !== undefined &&
    (currentUserMember.role === 'owner' || currentUserMember.role === 'admin');

  // Personal namespaces have no member docs — ownership is via linkedUserId
  const isPersonalOwner =
    namespace !== null &&
    namespace.type === 'personal' &&
    namespace.linkedUserId === user?.id;

  const canEditProfile = canManageMembers || isPersonalOwner;

  // Which danger-zone action the workspace offers: a personal workspace can
  // only be reset (the API refuses to delete one — issue #1044), an
  // organization can be deleted. Personal ownership also counts as owner here
  // for the legacy rows that predate the owner member doc.
  const isPersonal = namespace?.type === 'personal';
  const canDestroyWorkspace = isOwner || isPersonalOwner;

  // Surface fail-cases for every workspace-altering action via one banner —
  // member removal, role flips, leave. (Delete and reset report inside their
  // own dialog.) Optimistic snapshot rollback hides the underlying error;
  // without this banner an admin would see the role un-flip and not know why.
  const [dangerError, setDangerError] = useState<string | null>(null);

  if (namespaceLoading || membersLoading) {
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

        {canEditProfile && <WorkspaceProfileSection handle={handle} namespace={namespace} />}

        <DefaultWorkspaceSection handle={handle} />

        <WorkspaceMembersSection
          handle={handle}
          members={members}
          personalHandles={personalHandles}
          canManageMembers={canManageMembers}
          isOwner={isOwner}
          currentUserId={user?.id}
          inviterName={user?.name ?? user?.email ?? undefined}
          onError={setDangerError}
        />

        {canEditProfile && user !== null && user.id !== '' && (
          <WorkspaceSecretsSection handle={handle} userId={user.id} />
        )}

        {canEditProfile && <WorkspaceAdministrationSection handle={handle} />}

        {dangerError !== null && (
          <div className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {dangerError}
          </div>
        )}

        <WorkspaceDangerZone
          handle={handle}
          isMember={currentUserMember !== undefined}
          isOwner={isOwner}
          isPersonal={isPersonal}
          canDestroyWorkspace={canDestroyWorkspace}
          onError={setDangerError}
        />
      </div>
    </div>
  );
}
