'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { useDeleteImageEntry } from '@/hooks/use-image-catalog';
import { useWorkflowsByImage } from '@/hooks/use-workflows-by-image';

/**
 * Retire an entry — and, if an admin asks for it, the images behind it.
 *
 * The dialog exists because these are two acts, not one, and only one of them
 * is safe. **Removing the entry removes an offer**: no Workflow Definition
 * references an entry, so no run changes behaviour and no pinned version stops
 * resolving (ADR-0022 decision 3) — which is why any member may do it.
 * **Removing the images destroys artifacts on a deployment-wide daemon**,
 * where a tag can back steps in namespaces this reader cannot see, so it is
 * admin-gated, opt-in, and shown with what it will take.
 *
 * The workflows pinning those tags are named before the click rather than
 * discovered afterwards. The scan behind them is deployment-wide for exactly
 * this reason: a public workflow in a workspace the reader never joined is
 * still a step that breaks.
 */
export function DeleteImageEntryDialog({
  entry,
  handle,
  canAdmin,
  open,
  onOpenChange,
}: {
  entry: ImageCatalogEntryView;
  handle: string;
  canAdmin: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // A discovered entry is derived from the daemon rather than stored, so there
  // is no record to remove — its images are the only thing there is to delete.
  const storedRow = entry.origin === 'catalogued';
  const [withImages, setWithImages] = useState(storedRow === false);
  const remove = useDeleteImageEntry(handle);
  const tags = entry.versions.map((version) => version.imageTag);
  const usage = useWorkflowsByImage(tags, open && tags.length > 0);
  const pinned = usage.workflows ?? [];

  const imagesOffered = canAdmin && tags.length > 0;
  const deletingImages = imagesOffered && withImages;
  // Nothing to do: no row to remove, and no permission or no image to remove
  // either. Saying so beats a button that would report success on a no-op.
  const nothingToDo = storedRow === false && deletingImages === false;

  function handleDelete() {
    remove.mutate(
      { id: entry.id, withImages: deletingImages },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (remove.isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">
                {storedRow ? `Delete ${entry.name}?` : `Delete the images of ${entry.name}?`}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {storedRow ? (
                  <>
                    Removing the entry removes an <em>offer</em>, never a capability: no workflow
                    points at an entry — a step pins an image tag — so nothing that runs today
                    changes. It can be catalogued again.
                  </>
                ) : (
                  <>
                    Nobody has described this image, so there is no record to remove. What can be
                    deleted is the image itself, from the deployment&apos;s daemon.
                  </>
                )}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={remove.isPending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="space-y-4">
            {tags.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {tags.length} version{tags.length === 1 ? '' : 's'} on the daemon
                </p>
                <ul className="max-h-32 divide-y overflow-y-auto rounded-md border bg-muted/20">
                  {tags.map((tag) => (
                    <li key={tag} className="break-all px-3 py-1.5 font-mono text-[11px]">
                      {tag}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {imagesOffered && (
              <label className="flex items-start gap-2.5 rounded-md border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={withImages}
                  onChange={(event) => setWithImages(event.target.checked)}
                  disabled={remove.isPending || storedRow === false}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <span className="font-medium">
                    Also remove {tags.length === 1 ? 'this image' : `these ${String(tags.length)} images`}{' '}
                    from the machine
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    Runs <code>docker rmi</code> on each tag on the deployment&apos;s daemon. The
                    daemon is shared by every workspace, and this cannot be undone — a deleted
                    image is rebuilt or pulled again, not restored.
                  </span>
                </span>
              </label>
            )}

            {canAdmin === false && tags.length > 0 && (
              <p className="text-xs text-muted-foreground">
                The {tags.length === 1 ? 'image' : 'images'} behind this entry stay on the daemon.
                Deleting from it is deployment-wide, so it is an admin&apos;s call — through{' '}
                <strong>Admin → Infrastructure</strong>.
              </p>
            )}

            {deletingImages && pinned.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-md border border-destructive bg-destructive/10 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                <div className="space-y-1 text-xs">
                  <p className="font-medium text-destructive">
                    {pinned.length === 1 ? 'A workflow step pins' : 'Workflow steps pin'} an image
                    you are about to delete. {pinned.length === 1 ? 'It' : 'They'} will fail at
                    container start until the image is built or pulled again.
                  </p>
                  <ul className="space-y-0.5 text-muted-foreground">
                    {pinned.map((workflow) => (
                      <li key={`${workflow.namespace}:${workflow.name}`}>
                        {workflow.title ?? workflow.name}
                        <span className={workflow.namespace === handle ? '' : 'font-medium'}>
                          {' '}
                          — {workflow.namespace}/{workflow.name} · {workflow.steps.join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {deletingImages && usage.loading && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Checking which workflows pin these images…
              </p>
            )}

            {remove.error !== null && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="break-all">{remove.error.message}</p>
                <p className="mt-1 text-xs">
                  The entry was kept: a version that would not delete is left reachable rather than
                  orphaned under a name nobody wrote. Docker refuses an image a container is using,
                  or one another image was built on.
                </p>
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={remove.isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={remove.isPending || nothingToDo}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {remove.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {deletingImages
                  ? `Delete ${storedRow ? 'entry and ' : ''}${String(tags.length)} image${tags.length === 1 ? '' : 's'}`
                  : 'Delete entry'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
