'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { useDeleteImageEntry } from '@/hooks/use-image-catalog';
import { useArchiveWorkflowVersion } from '@/hooks/use-archive-workflow-version';
import { useWorkflowsByImage, type WorkflowImageMatch } from '@/hooks/use-workflows-by-image';

/**
 * Retire an entry and the images behind it.
 *
 * One act, not two: an entry is an offer *for* images, and a record whose
 * images stay on the daemon achieves nothing — for anything this workspace
 * built, the row is re-derived on the next read and comes back marked "Needs a
 * description", losing only the sentence somebody wrote. So delete means both,
 * and when the daemon holds no image for the entry it simply removes the
 * record.
 *
 * That makes it destructive and deployment-wide, which is why it is
 * admin-gated and why this dialog leads with what pins those images:
 *
 * - **A live version** — the one a run starts from — **blocks the delete.** Its
 *   author can still re-point the step, so breaking it is a choice nobody needs
 *   to make. Archiving that version is offered here, since the alternative is
 *   deleting a whole workflow to reclaim one image.
 * - **A superseded or archived version does not block.** A registered version
 *   is immutable, so no edit can move it off the image; refusing on its account
 *   would mean an image pinned once could never be reclaimed. It is listed, so
 *   the loss is seen rather than discovered later.
 */

function PinLine({ pin, handle }: { pin: WorkflowImageMatch; handle: string }) {
  return (
    <>
      <span className="font-medium">{pin.title ?? pin.name}</span>
      <span
        className="text-muted-foreground"
        title={pin.namespace === handle ? undefined : `In @${pin.namespace}, not @${handle}`}
      >
        {' '}
        — {pin.namespace}/{pin.name} v{pin.version} · {pin.steps.join(', ')}
        {pin.archived ? ' · archived' : ''}
      </span>
    </>
  );
}

export function DeleteImageEntryDialog({
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
  const remove = useDeleteImageEntry(handle);
  const archive = useArchiveWorkflowVersion();
  const tags = entry.versions.map((version) => version.imageTag);
  // `all`, not the default: every version and archived workflows included. The
  // narrow answer would hide exactly the history this delete destroys.
  const usage = useWorkflowsByImage(tags, open && tags.length > 0, 'all');
  const pins = usage.workflows ?? [];
  const live = pins.filter((pin) => pin.live);
  const historical = pins.filter((pin) => pin.live === false);
  const [archived, setArchived] = useState<ReadonlySet<string>>(new Set());
  const blockingLive = live.filter((pin) => !archived.has(pinKey(pin)));

  const storedRow = entry.origin === 'catalogued';
  // Until the scan answers, there is nothing to judge — the button waits rather
  // than offering a delete whose blast radius is still unknown.
  const blocked = usage.loading || blockingLive.length > 0;

  function pinKey(pin: WorkflowImageMatch): string {
    return `${pin.namespace}:${pin.name}:${pin.version}`;
  }

  function handleArchive(pin: WorkflowImageMatch) {
    archive.mutate(
      { namespace: pin.namespace, name: pin.name, version: pin.version },
      {
        onSuccess: () =>
          setArchived((current) => new Set(current).add(pinKey(pin))),
      },
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
              <Dialog.Title className="text-lg font-semibold">Delete {entry.name}?</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {tags.length === 0 ? (
                  <>
                    No image for this entry is on the daemon, so this removes the record and
                    nothing else. The source can be catalogued again.
                  </>
                ) : (
                  <>
                    Removes the entry <strong>and</strong> its{' '}
                    {tags.length === 1 ? 'image' : `${String(tags.length)} images`} from the
                    deployment&apos;s daemon. The daemon is shared by every workspace, and this
                    cannot be undone — a deleted image is rebuilt or pulled again, never restored.
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
                  {tags.length} version{tags.length === 1 ? '' : 's'} to remove
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

            {usage.error !== null && (
              <p className="text-xs text-destructive">
                Could not check which workflows use these images: {usage.error.message}
              </p>
            )}

            {usage.loading && (
              <p className="text-xs text-muted-foreground animate-pulse">
                Checking which workflows use these images…
              </p>
            )}

            {blockingLive.length > 0 && (
              <div
                data-testid="delete-blocked"
                className="space-y-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2"
              >
                <div className="flex items-start gap-2.5">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
                  <p className="text-xs font-medium text-destructive">
                    {blockingLive.length === 1
                      ? 'A workflow version that runs today pins one of these images.'
                      : `${String(blockingLive.length)} workflow versions that run today pin these images.`}{' '}
                    Point those steps at another image, or archive the version, and this delete
                    unblocks.
                  </p>
                </div>
                <ul className="space-y-1.5">
                  {blockingLive.map((pin) => (
                    <li
                      key={pinKey(pin)}
                      className="flex items-start justify-between gap-3 text-xs"
                    >
                      <span>
                        <PinLine pin={pin} handle={handle} />
                      </span>
                      {pin.isDefault ? (
                        // Archiving a workflow's chosen default would leave it
                        // pointing at a version that cannot run — a worse mess
                        // than the image staying. Only the platform's UI
                        // enforces that rule, so it has to be honoured here.
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          default version
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleArchive(pin)}
                          disabled={archive.isPending}
                          className="shrink-0 rounded-md border bg-background px-2 py-1 text-[11px] font-medium transition-colors hover:bg-muted disabled:opacity-50"
                        >
                          Archive v{pin.version}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
                {archive.error !== null && (
                  <p className="text-xs text-destructive">{archive.error.message}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Archiving one version leaves the rest of the workflow alone — the whole workflow
                  does not have to go to reclaim an image. A version the workflow pins as its{' '}
                  <strong>default</strong> cannot be archived that way: point its step at another
                  image, or make a different version the default first.
                </p>
              </div>
            )}

            {historical.length > 0 && (
              <div className="space-y-1.5 rounded-md border bg-muted/20 px-3 py-2">
                <p className="text-xs">
                  <strong>
                    {historical.length === 1
                      ? 'One superseded version'
                      : `${String(historical.length)} superseded versions`}
                  </strong>{' '}
                  <span className="text-muted-foreground">
                    also{historical.length === 1 ? 's' : ''} pin{historical.length === 1 ? 's' : ''}{' '}
                    these images. They do not block: a registered version is immutable, so no edit
                    can move it off the image. Re-running one after this would fail at container
                    start.
                  </span>
                </p>
                <ul className="max-h-28 space-y-0.5 overflow-y-auto">
                  {historical.map((pin) => (
                    <li key={pinKey(pin)} className="text-xs">
                      <PinLine pin={pin} handle={handle} />
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {remove.error !== null && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className="break-all">{remove.error.message}</p>
                <p className="mt-1 text-xs">
                  Nothing was removed. Docker refuses an image a container is using, or one another
                  image was built on.
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
                onClick={() =>
                  remove.mutate(
                    { id: entry.id, withImages: tags.length > 0 },
                    { onSuccess: () => onOpenChange(false) },
                  )
                }
                disabled={remove.isPending || blocked}
                className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-4 py-2 text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
              >
                {remove.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {tags.length === 0
                  ? 'Delete entry'
                  : `Delete ${storedRow ? 'entry and ' : ''}${String(tags.length)} image${tags.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
