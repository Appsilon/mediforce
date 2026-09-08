'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { useDescribeImage } from '@/hooks/use-image-catalog';

/**
 * The one thing a human adds to a discovered entry.
 *
 * Two fields, and no more: everything else on the entry was derived from the
 * image the platform built (ADR-0022 decision 2), so a form that also asked
 * for contents would be collecting the fields that go stale. The source is
 * shown and not editable — it is the entry's key, and this dialog describes
 * the image the workspace already has rather than pointing at a different one.
 */
export function DescribeImageDialog({
  entry,
  handle,
  open,
  onOpenChange,
}: {
  entry: ImageCatalogEntryView;
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(entry.name);
  const [intent, setIntent] = useState('');
  const describe = useDescribeImage(handle);

  const sourceLine =
    entry.source.kind === 'built'
      ? `${entry.source.repo}${entry.source.dockerfile === '' ? '' : ` · ${entry.source.dockerfile}`}`
      : entry.source.reference;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    await describe.mutateAsync({ name: name.trim(), intent: intent.trim(), source: entry.source });
    onOpenChange(false);
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (describe.isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Describe this image</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                @{handle} built this image and nobody has said what it is for. Write that one
                sentence and it joins the catalog — the platform derives the rest.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={describe.isPending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Source
              </p>
              <p className="mt-0.5 break-all font-mono text-xs">{sourceLine}</p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="describe-image-name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="describe-image-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Suggested from the repository. Rename it to what your team calls this image.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="describe-image-intent" className="text-sm font-medium">
                Intent
              </label>
              <textarea
                id="describe-image-intent"
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                required
                rows={3}
                placeholder="R-based interactive exploration of ADaM datasets"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                What the image is <em>for</em>, not what is inside it. Contents change with every
                rebuild; intent survives them, which is why this is the one field you write and the
                rest is derived.
              </p>
            </div>

            {describe.error !== null && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {describe.error.message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={describe.isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={describe.isPending || name.trim() === '' || intent.trim() === ''}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {describe.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {describe.isPending ? 'Probing the image…' : 'Add to the catalog'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
