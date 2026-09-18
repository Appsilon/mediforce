'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { carriedSourceLine, toSlug } from '@mediforce/platform-core';
import type {
  ImageCatalogEntryView,
  ImageCatalogVersion,
} from '@mediforce/platform-api/contract';
import { useImageCatalogEntries, usePublishImageVersion } from '@/hooks/use-image-catalog';
import { describeBuildFailure } from './build-error';
import { BuildFailureNotice } from './build-failure-notice';
import {
  ImageNameField,
  ImageTagField,
  NewEntryFields,
  referencedEntryFor,
} from './referenced-image-fields';

/**
 * **Publish as image** on one version of a carried entry.
 *
 * A carried image lives only as long as a workflow carries its files, and has
 * no Build of its own — it builds when a step runs. Publishing rebuilds that
 * version's files into a referenced entry under the workspace's name, so it
 * outlives the workflow and follows every upload rule (ADR-0022).
 */
export function PublishImageDialog({
  entry,
  version,
  handle,
  open,
  onOpenChange,
}: {
  entry: ImageCatalogEntryView;
  version: ImageCatalogVersion;
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workflow = entry.source.kind === 'carried' ? entry.source.workflow : '';
  const [imageName, setImageName] = useState(toSlug(workflow));
  const [tag, setTag] = useState('');
  const [name, setName] = useState(entry.name);
  const [intent, setIntent] = useState(entry.intent);
  const publish = usePublishImageVersion(handle);
  const { entries } = useImageCatalogEntries(handle);

  if (entry.source.kind !== 'carried') return null;
  const { dockerfile } = entry.source;

  const reference = `${handle}/${imageName.trim()}`;
  const existing = referencedEntryFor(entries, reference);
  const failure = publish.error === null ? null : describeBuildFailure(publish.error.message);
  const canSubmit =
    publish.isPending === false &&
    imageName.trim() !== '' &&
    (existing !== undefined || (name.trim() !== '' && intent.trim() !== ''));

  // `mutate`, not `mutateAsync`, for the reason the other dialogs give: a
  // rejected build renders below instead of escaping as an unhandled rejection.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    publish.mutate(
      {
        id: entry.id,
        imageTag: version.imageTag,
        reference,
        ...(tag.trim() === '' ? {} : { tag: tag.trim() }),
        ...(existing === undefined ? { name: name.trim(), intent: intent.trim() } : {}),
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        // Closing mid-build would leave the only progress indicator with no
        // way back to it — the request is still running either way.
        if (publish.isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Publish as image</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                This image lives only as long as workflow {workflow} carries its files. Publishing
                rebuilds this version into an image of its own, which any step can pin after the
                workflow changes them.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={publish.isPending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Version
              </p>
              <p className="mt-0.5 break-all font-mono text-xs">{version.imageTag}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
                {carriedSourceLine(workflow, dockerfile)}
              </p>
            </div>

            <ImageNameField
              idPrefix="publish-image"
              handle={handle}
              value={imageName}
              onChange={setImageName}
              existing={existing}
            />

            <ImageTagField
              idPrefix="publish-image"
              value={tag}
              onChange={setTag}
              placeholder="the publish time"
            />

            {existing === undefined && (
              <NewEntryFields
                idPrefix="publish-image"
                name={name}
                onNameChange={setName}
                intent={intent}
                onIntentChange={setIntent}
                intentPlaceholder="Runs the ADaM checks outside the workflow that built it"
              />
            )}

            {failure !== null && <BuildFailureNotice failure={failure} />}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={publish.isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={canSubmit === false}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {publish.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {publish.isPending ? 'Publishing — this can take minutes…' : 'Publish'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
