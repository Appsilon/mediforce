'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import { UploadImageForm } from './upload-image-form';

/** **Upload version** on a referenced entry this workspace uploaded. */
export function UploadImageDialog({
  reference,
  handle,
  open,
  onOpenChange,
}: {
  reference: string;
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        // Closing mid-build would leave the only progress indicator with no
        // way back to it — the request is still running either way.
        if (pending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Upload a version</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Builds a new version of this image from a folder on your machine.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={pending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>
          <UploadImageForm
            handle={handle}
            fixedReference={reference}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
            onPendingChange={setPending}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
