'use client';

import * as React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { deleteWorkflow, getWorkflowRunCount } from '@/app/actions/definitions';

interface DeleteWorkflowDialogProps {
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

type DialogState =
  | { step: 'loading' }
  | { step: 'confirm'; runCount: number }
  | { step: 'deleting' }
  | { step: 'error'; message: string; runCount: number };

export function DeleteWorkflowDialog({ workflowName, open, onOpenChange, onDeleted }: DeleteWorkflowDialogProps) {
  const [state, setState] = React.useState<DialogState>({ step: 'loading' });
  const [nameInput, setNameInput] = React.useState('');
  const [runCountInput, setRunCountInput] = React.useState('');

  const runCount = state.step === 'confirm' || state.step === 'error' ? state.runCount : 0;

  const nameMatches = nameInput === workflowName;
  const runCountMatches = runCount === 0 || runCountInput === String(runCount);
  const canConfirm = nameMatches && runCountMatches && state.step === 'confirm';

  React.useEffect(() => {
    if (!open) return;
    setState({ step: 'loading' });
    setNameInput('');
    setRunCountInput('');
    getWorkflowRunCount(workflowName)
      .then((count) => setState({ step: 'confirm', runCount: count }))
      .catch(() => setState({ step: 'error', message: 'Failed to load run count.', runCount: 0 }));
  }, [open, workflowName]);

  function handleClose() {
    if (state.step === 'deleting') return;
    onOpenChange(false);
  }

  async function handleDelete() {
    if (!canConfirm) return;
    setState({ step: 'deleting' });
    const result = await deleteWorkflow(workflowName, runCount);
    if (result.success) {
      onOpenChange(false);
      onDeleted();
    } else {
      setState({ step: 'error', message: result.error, runCount });
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
              Delete Workflow
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
                This will permanently hide <span className="font-semibold text-foreground">{workflowName}</span> and
                all its versions from the platform. This action cannot be easily undone.
              </Dialog.Description>

              {runCount > 0 && (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">
                    This will also delete {runCount} associated run{runCount !== 1 ? 's' : ''}.
                  </p>
                  <p className="text-muted-foreground mt-1">
                    All process instances, tasks, and agent runs for this workflow will be removed.
                  </p>
                </div>
              )}

              {state.step === 'error' && (
                <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive">
                  {state.message}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium" htmlFor="delete-name-input">
                    Type <span className="font-mono bg-muted px-1 py-0.5 rounded text-xs">{workflowName}</span> to confirm
                  </label>
                  <input
                    id="delete-name-input"
                    type="text"
                    value={nameInput}
                    onChange={(event) => setNameInput(event.target.value)}
                    placeholder={workflowName}
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-destructive/50"
                    autoComplete="off"
                  />
                </div>

                {runCount > 0 && (
                  <div>
                    <label className="text-sm font-medium" htmlFor="delete-run-count-input">
                      Type the number of runs (<span className="font-mono bg-muted px-1 py-0.5 rounded text-xs">{runCount}</span>) to confirm cascade deletion
                    </label>
                    <input
                      id="delete-run-count-input"
                      type="text"
                      value={runCountInput}
                      onChange={(event) => setRunCountInput(event.target.value)}
                      placeholder={String(runCount)}
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
                  onClick={handleDelete}
                  disabled={!canConfirm}
                  className={cn(
                    'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                    canConfirm
                      ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                      : 'bg-destructive/30 text-destructive-foreground/50 cursor-not-allowed',
                  )}
                >
                  Delete workflow
                </button>
              </div>
            </div>
          )}

          {state.step === 'deleting' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 className="h-5 w-5 animate-spin text-destructive" />
              <p className="text-sm text-muted-foreground">Deleting workflow...</p>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
