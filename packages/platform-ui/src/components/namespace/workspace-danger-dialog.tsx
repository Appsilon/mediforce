'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforce, ApiError } from '@/lib/mediforce';
import { useDeleteNamespace, useResetNamespace } from '@/hooks/use-namespace-mutations';

export type WorkspaceDangerMode = 'delete' | 'reset';

interface WorkspaceDangerDialogProps {
  mode: WorkspaceDangerMode;
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

type DialogState =
  | { step: 'loading' }
  | { step: 'confirm'; workflowCount: number }
  | { step: 'working'; workflowCount: number }
  | { step: 'error'; message: string; workflowCount: number };

const COPY: Record<WorkspaceDangerMode, {
  title: string;
  confirmLabel: string;
  workingLabel: string;
  describe: (handle: string) => React.ReactNode;
  cascadeNote: string;
}> = {
  delete: {
    title: 'Delete Workspace',
    confirmLabel: 'Delete workspace',
    workingLabel: 'Deleting workspace...',
    describe: (handle) => (
      <>
        This permanently deletes <span className="font-semibold text-foreground">@{handle}</span>,
        removes every member, and destroys every workflow, run, task and secret it holds. It cannot
        be undone.
      </>
    ),
    // The workspace row itself goes, and `agent_runs.workspace` is
    // ON DELETE CASCADE — agent runs really do disappear with it.
    cascadeNote: 'All runs, tasks, and agent runs in this workspace will be removed.',
  },
  reset: {
    title: 'Reset Workspace',
    confirmLabel: 'Reset workspace',
    workingLabel: 'Resetting workspace...',
    describe: (handle) => (
      <>
        This deletes every workflow in <span className="font-semibold text-foreground">@{handle}</span>{' '}
        along with their runs and tasks. The workspace, its members and its secrets stay. It cannot
        be undone.
      </>
    ),
    // Reset runs the per-workflow cascade, which soft-deletes definitions,
    // runs and human tasks. `agent_runs` is keyed off the workspace, not the
    // run's deleted flag, so that history survives — say so rather than
    // promising a removal that never happens.
    cascadeNote:
      'All runs and tasks for those workflows will be removed. Agent run history for the workspace stays.',
  },
};

/**
 * Two-confirmation gate for the workspace danger zone, mirroring
 * `DeleteWorkflowDialog`: the operator types the handle, and — when the
 * workspace still holds workflows — the number about to be destroyed, so the
 * blast radius is read before it is accepted.
 */
export function WorkspaceDangerDialog({ mode, handle, open, onOpenChange, onDone }: WorkspaceDangerDialogProps) {
  const [state, setState] = React.useState<DialogState>({ step: 'loading' });
  const [handleInput, setHandleInput] = React.useState('');
  const [countInput, setCountInput] = React.useState('');
  const deleteNamespace = useDeleteNamespace();
  const resetNamespace = useResetNamespace();
  const copy = COPY[mode];

  const workflowCount =
    state.step === 'loading' ? 0 : state.workflowCount;
  const handleMatches = handleInput === handle;
  const countMatches = workflowCount === 0 || countInput === String(workflowCount);
  const canConfirm = handleMatches && countMatches && state.step === 'confirm';

  React.useEffect(() => {
    if (!open) return;
    setState({ step: 'loading' });
    setHandleInput('');
    setCountInput('');
    mediforce.workflows
      // Archived workflows are destroyed too, so they have to be counted —
      // the catalog's default view hides them.
      .list({ namespace: handle, includeCompletedRuns: false, includeArchived: true })
      .then(({ definitions }) => setState({ step: 'confirm', workflowCount: definitions.length }))
      .catch(() =>
        setState({ step: 'error', message: 'Failed to load the workspace contents.', workflowCount: 0 }),
      );
  }, [open, handle]);

  function handleClose() {
    if (state.step === 'working') return;
    onOpenChange(false);
  }

  async function handleConfirm() {
    if (!canConfirm) return;
    setState({ step: 'working', workflowCount });
    try {
      if (mode === 'delete') {
        await deleteNamespace.mutateAsync({ handle });
      } else {
        await resetNamespace.mutateAsync({ handle });
      }
      onOpenChange(false);
      onDone();
    } catch (err) {
      const message = err instanceof ApiError ? err.message
        : err instanceof Error ? err.message : 'Unknown error';
      setState({ step: 'error', message, workflowCount });
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(value) => { if (!value) handleClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-lg font-semibold flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {copy.title}
            </Dialog.Title>
            <Dialog.Close asChild>
              <button className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {state.step === 'loading' && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {(state.step === 'confirm' || state.step === 'error') && (
            <div className="space-y-4">
              <Dialog.Description className="text-sm text-muted-foreground">
                {copy.describe(handle)}
              </Dialog.Description>

              {workflowCount > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    This will delete {workflowCount} workflow{workflowCount !== 1 ? 's' : ''}.
                  </p>
                  <p className="text-muted-foreground mt-1">{copy.cascadeNote}</p>
                </div>
              )}

              {state.step === 'error' && (
                <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  {state.message}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium" htmlFor="workspace-danger-handle-input">
                    Type <span className="font-mono bg-muted px-1 py-0.5 rounded text-xs">{handle}</span> to confirm
                  </label>
                  <input
                    id="workspace-danger-handle-input"
                    type="text"
                    value={handleInput}
                    onChange={(event) => setHandleInput(event.target.value)}
                    placeholder={handle}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-destructive/50"
                    autoComplete="off"
                  />
                </div>

                {workflowCount > 0 && (
                  <div>
                    <label className="text-sm font-medium" htmlFor="workspace-danger-count-input">
                      Type the number of workflows (<span className="font-mono bg-muted px-1 py-0.5 rounded text-xs">{workflowCount}</span>) to confirm cascade deletion
                    </label>
                    <input
                      id="workspace-danger-count-input"
                      type="text"
                      value={countInput}
                      onChange={(event) => setCountInput(event.target.value)}
                      placeholder={String(workflowCount)}
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-destructive/50"
                      autoComplete="off"
                    />
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={handleClose}
                  className="rounded-md px-4 py-2 text-sm font-medium border hover:bg-muted transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirm}
                  disabled={!canConfirm}
                  className={cn(
                    'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                    canConfirm
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : 'bg-destructive/30 text-destructive-foreground/50 cursor-not-allowed',
                  )}
                >
                  {copy.confirmLabel}
                </button>
              </div>
            </div>
          )}

          {state.step === 'working' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-destructive" />
              <p className="text-sm text-muted-foreground">{copy.workingLabel}</p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
