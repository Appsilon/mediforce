'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut, RotateCcw, Trash2 } from 'lucide-react';
import { ApiError } from '@/lib/mediforce';
import { useLeaveNamespace } from '@/hooks/use-namespace-mutations';
import {
  WorkspaceDangerDialog,
  type WorkspaceDangerMode,
} from '@/components/namespace/workspace-danger-dialog';

interface WorkspaceDangerZoneProps {
  handle: string;
  /** The viewer holds an explicit member doc in this workspace. */
  isMember: boolean;
  isOwner: boolean;
  isPersonal: boolean;
  /** Owner of an organization, or the user a personal workspace is linked to. */
  canDestroyWorkspace: boolean;
  onError: (message: string | null) => void;
}

/**
 * Leave / reset / delete. A personal workspace cannot be deleted — `getMe`
 * re-bootstraps one for every user, so the API rejects it (issue #1044).
 * Reset is the destructive action it does offer.
 */
export function WorkspaceDangerZone({
  handle,
  isMember,
  isOwner,
  isPersonal,
  canDestroyWorkspace,
  onError,
}: WorkspaceDangerZoneProps) {
  const router = useRouter();
  const [dangerDialog, setDangerDialog] = useState<WorkspaceDangerMode | null>(null);
  const leaveNamespace = useLeaveNamespace();
  const leaving = leaveNamespace.isPending;

  async function handleLeaveWorkspace() {
    onError(null);
    try {
      await leaveNamespace.mutateAsync({ handle });
      router.push('/workspace-selection');
    } catch (err: unknown) {
      if (err instanceof ApiError && err.code === 'precondition_failed') {
        onError(err.message);
        return;
      }
      onError(err instanceof Error ? err.message : 'Failed to leave workspace.');
    }
  }

  return (
    <>
      {!isOwner && isMember && (
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

      {canDestroyWorkspace && isPersonal === true && (
        <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
          <h2 className="text-sm font-semibold mb-1 text-destructive">Reset workspace</h2>
          <p className="text-xs text-muted-foreground mb-3">
            This deletes every workflow in <span className="font-semibold">@{handle}</span> along with their runs and tasks, and cannot be undone. The workspace, its members and its secrets stay — a personal workspace cannot be deleted, because you always need one.
          </p>
          <button
            type="button"
            onClick={() => setDangerDialog('reset')}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset workspace
          </button>
        </div>
      )}

      {isOwner && isPersonal === false && (
        <div className="rounded-lg border border-destructive/30 bg-card px-4 py-5">
          <h2 className="text-sm font-semibold mb-1 text-destructive">Delete workspace</h2>
          <p className="text-xs text-muted-foreground mb-3">
            This will permanently delete <span className="font-semibold">@{handle}</span>, remove all members, destroy every workflow, run, task and secret it holds, and cannot be undone.
          </p>
          <button
            type="button"
            onClick={() => setDangerDialog('delete')}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete workspace
          </button>
        </div>
      )}

      {dangerDialog !== null && (
        <WorkspaceDangerDialog
          mode={dangerDialog}
          handle={handle}
          open
          onOpenChange={(value) => { if (!value) setDangerDialog(null); }}
          onDone={() => {
            setDangerDialog(null);
            if (dangerDialog === 'delete') router.push('/workspace-selection');
          }}
        />
      )}
    </>
  );
}
