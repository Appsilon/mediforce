'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { builtSourceLine, catalogDockerfileKey } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { useCatalogueImage, useUpdateImageEntry } from '@/hooks/use-image-catalog';
import { DockerfileAndContextFields } from './build-source-fields';

type Source = ImageCatalogEntryView['source'];

/**
 * Everything a human wrote about an entry: its source, its name, and the
 * sentence saying what the image is for.
 *
 * Nothing else is offered, because nothing else is written — versions,
 * capabilities and lineage are derived from the image on every read (ADR-0022
 * decision 2), so a form that asked for them would be collecting the fields
 * that go stale.
 *
 * One form, two writes, chosen by what the entry already is rather than by the
 * caller:
 *
 * - **discovered** — the platform built the image and nobody has written the
 *   sentence. There is no stored row to patch, so the write is the same `POST`
 *   **Add image** uses, and the id derives from the source, so it lands at the
 *   identity the listing was already showing (decision 7). The source is shown
 *   and **not** editable here: a build recorded it, and re-pointing it would
 *   describe some other source while leaving this one still undescribed.
 * - **catalogued** — a stored row, so the write is a `PATCH` on its id, and
 *   the source is editable. Since the id derives from the source, changing it
 *   **re-keys** the entry: the handler writes the row at the new id and drops
 *   the old one. That is safe by the property that makes deleting safe — no
 *   Workflow Definition references an entry (decision 3) — and it is what
 *   makes a mistyped repository fixable rather than permanent.
 */

const COPY = {
  describe: {
    title: 'Describe this image',
    submit: 'Add to the catalog',
    pending: 'Probing the image…',
    nameHint: null,
  },
  edit: {
    title: 'Edit this image',
    submit: 'Save changes',
    pending: 'Saving…',
    nameHint:
      'What your team calls this image. No workflow points at an entry — a step pins an image tag — so renaming one breaks nothing.',
  },
} as const;

/** Compared field by field rather than by identity, so retyping the same value
 *  is not sent as a change. */
function sameSource(edited: Source, stored: Source): boolean {
  if (edited.kind === 'built' && stored.kind === 'built') {
    return (
      edited.repo === stored.repo &&
      edited.dockerfile === stored.dockerfile &&
      (edited.context ?? '') === (stored.context ?? '')
    );
  }
  if (edited.kind === 'referenced' && stored.kind === 'referenced') {
    return edited.reference === stored.reference;
  }
  return false;
}

/** Whether the edit lands on the same key. A new context for the same
 *  Dockerfile is not a re-key — the key is the file, not how it is built. The
 *  server canonicalises the repo before it decides, so this only governs
 *  whether the warning shows. */
function sameKey(edited: Source, stored: Source): boolean {
  if (edited.kind === 'built' && stored.kind === 'built') {
    return (
      edited.repo === stored.repo &&
      catalogDockerfileKey(edited.dockerfile, edited.context) ===
        catalogDockerfileKey(stored.dockerfile, stored.context)
    );
  }
  return sameSource(edited, stored);
}

export function ImageDescriptionDialog({
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
  const describing = entry.origin === 'discovered';
  const copy = describing ? COPY.describe : COPY.edit;
  const [name, setName] = useState(entry.name);
  // Empty for a discovered entry, which is the one field no build can derive.
  const [intent, setIntent] = useState(entry.intent);
  // Only the entry's own kind is offered. Turning a `referenced` entry into a
  // `built` one changes which inputs the platform holds for it, and that is
  // **Add image**'s job — an edit corrects a source, it does not change what
  // kind of thing the entry is.
  const built = entry.source.kind === 'built';
  const [repo, setRepo] = useState(entry.source.kind === 'built' ? entry.source.repo : '');
  const [dockerfile, setDockerfile] = useState(
    entry.source.kind === 'built' ? entry.source.dockerfile : '',
  );
  const [context, setContext] = useState(
    entry.source.kind === 'built' ? (entry.source.context ?? '') : '',
  );
  const [reference, setReference] = useState(
    entry.source.kind === 'referenced' ? entry.source.reference : '',
  );
  const catalogue = useCatalogueImage(handle);
  const update = useUpdateImageEntry(handle);
  const isPending = catalogue.isPending || update.isPending;
  const error = catalogue.error ?? update.error;

  const editedSource: Source = built
    ? {
        kind: 'built',
        repo: repo.trim(),
        dockerfile: dockerfile.trim(),
        context: context.trim() === '' ? undefined : context.trim(),
      }
    : { kind: 'referenced', reference: reference.trim() };
  const sourceChanged = !describing && !sameSource(editedSource, entry.source);
  const rekeys = sourceChanged && !sameKey(editedSource, entry.source);
  const sourceIncomplete = built ? repo.trim() === '' : reference.trim() === '';

  const storedSourceLine =
    entry.source.kind === 'built'
      ? builtSourceLine(entry.source.repo, entry.source.dockerfile, entry.source.context)
      : entry.source.reference;

  // `mutate`, not `mutateAsync`: an async submit handler whose promise rejects
  // has nothing to catch it, so a rejected write both renders below and escapes
  // as an unhandled rejection. The error still lands on the mutation.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const written = { name: name.trim(), intent: intent.trim() };
    const settle = { onSuccess: () => onOpenChange(false) };
    if (describing) {
      catalogue.mutate({ ...written, source: entry.source }, settle);
      return;
    }
    // Sent only when it actually changed, so an edit to the sentence stays an
    // edit to the sentence in the audit trail.
    update.mutate(
      {
        id: entry.id,
        ...written,
        ...(sourceChanged ? { source: editedSource } : {}),
      },
      settle,
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">{copy.title}</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {describing ? (
                  <>
                    @{handle} built this image and nobody has said what it is for. Write that one
                    sentence and it joins the catalog — the platform derives the rest.
                  </>
                ) : (
                  <>
                    The source, the name and the sentence are what a human wrote here. Versions,
                    capabilities and lineage are derived from the image on every read, so there is
                    nothing else to edit.
                  </>
                )}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={isPending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {describing ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  Source
                </p>
                <p className="mt-0.5 break-all font-mono text-xs">{storedSourceLine}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Recorded by the build that made this image, so it is not typed here. Once the
                  entry exists, <strong>Edit</strong> can correct it.
                </p>
              </div>
            ) : built ? (
              <>
                <div className="space-y-1.5">
                  <label htmlFor="image-description-repo" className="text-sm font-medium">
                    Repository
                  </label>
                  <input
                    id="image-description-repo"
                    value={repo}
                    onChange={(event) => setRepo(event.target.value)}
                    required
                    placeholder="Appsilon/tealflow"
                    className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">
                    <code>owner/repo</code>, or a full <code>git@…</code> / <code>https://…</code>{' '}
                    reference. It is stored in one canonical form, so the entry matches images built
                    from it however a step author wrote it.
                  </p>
                </div>

                <DockerfileAndContextFields
                  idPrefix="image-description"
                  dockerfile={dockerfile}
                  onDockerfileChange={setDockerfile}
                  context={context}
                  onContextChange={setContext}
                />
              </>
            ) : (
              <div className="space-y-1.5">
                <label htmlFor="image-description-reference" className="text-sm font-medium">
                  Image reference
                </label>
                <input
                  id="image-description-reference"
                  value={reference}
                  onChange={(event) => setReference(event.target.value)}
                  required
                  placeholder="mediforce-golden-image"
                  className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <p className="text-xs text-muted-foreground">
                  Untagged — the tags and digests on the daemon are this entry&apos;s versions. The
                  platform holds no build inputs for it, so there is no repository to name.
                </p>
              </div>
            )}

            {rekeys && (
              <div className="flex items-start gap-2.5 rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-800 dark:bg-amber-950/20">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                <div className="space-y-1 text-xs text-muted-foreground">
                  <p>
                    <strong className="text-foreground">
                      The entry is keyed on its source, so this moves it.
                    </strong>{' '}
                    Saving writes it under a new id and removes the old one — one entry, corrected,
                    not two rows to choose between.
                  </p>
                  <p>
                    If this names a genuinely different image, the versions built from the old
                    source stop belonging to this entry. They stay on the daemon and reappear on
                    their own, marked <strong>Needs a description</strong>.
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <label htmlFor="image-description-name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="image-description-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {copy.nameHint !== null && <p className="text-xs text-muted-foreground">{copy.nameHint}</p>}
            </div>

            <div className="space-y-1.5">
              <label htmlFor="image-description-intent" className="text-sm font-medium">
                Description
              </label>
              <textarea
                id="image-description-intent"
                value={intent}
                onChange={(event) => setIntent(event.target.value)}
                required
                rows={3}
                placeholder="R-based interactive exploration of ADaM datasets"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {error !== null && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error.message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  isPending || name.trim() === '' || intent.trim() === '' || sourceIncomplete
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {isPending ? copy.pending : copy.submit}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
