'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useState } from 'react';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { CatalogueExistingImageForm } from './catalogue-existing-image-form';

/**
 * Add a catalog record for one image the daemon already holds — Admin →
 * Infrastructure's counterpart to the Images tab's **Existing image** option,
 * for a row with no catalog match yet (no "open in catalog" link to follow).
 */
export function CatalogueExistingImageDialog({
  handle,
  image,
  open,
  onOpenChange,
}: {
  handle: string;
  image: DockerImageInfo;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add to the image catalog</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                This image is already on the daemon — no build, just a name and a sentence about what
                it is for.
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

          <CatalogueExistingImageForm
            handle={handle}
            image={image}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
            onPendingChange={setPending}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
