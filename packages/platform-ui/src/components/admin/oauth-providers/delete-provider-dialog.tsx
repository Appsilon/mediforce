'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState } from 'react';

interface DeleteProviderDialogProps {
  providerId: string;
  providerName: string;
  /** Count of agent bindings still referencing this provider. Non-blocking —
   *  admin can delete anyway; those bindings will fail at connect time until
   *  the provider is re-created or the bindings are repointed. */
  referenceCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteProviderDialog({
  providerId,
  providerName,
  referenceCount,
  open,
  onOpenChange,
  onConfirm,
}: DeleteProviderDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setDeleting(true);
    setError(null);
    // Close the dialog FIRST so React can unmount it while the HTTP call is
    // in flight. Closing after await deadlocks the Radix dialog under
    // concurrent rendering.
    onOpenChange(false);
    try {
      await onConfirm();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (deleting) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-center justify-between">
            <Dialog.Title className="flex items-center gap-2 text-lg font-semibold">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete OAuth provider
            </Dialog.Title>
            <Dialog.Close asChild>
              <button
                disabled={deleting}
                className="rounded-sm p-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <Dialog.Description className="text-sm text-muted-foreground">
            Remove <span className="font-mono text-foreground">{providerId}</span>
            {' '}({providerName}) from this namespace. Bindings that reference this provider will fail to
            initiate an OAuth flow until it is re-added or the bindings are updated.
          </Dialog.Description>

          {referenceCount > 0 && (
            <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-700 dark:text-amber-300">
                {referenceCount} agent {referenceCount === 1 ? 'binding references' : 'bindings reference'} this provider.
              </p>
              <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/80">
                Previously-connected tokens continue to work at spawn time, but no new OAuth flow can
                start for those bindings until the provider is re-added.
              </p>
            </div>
          )}

          {error !== null && (
            <div className="mt-3 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={deleting}
              className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={deleting}
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50 transition-colors"
            >
              {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Delete
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
