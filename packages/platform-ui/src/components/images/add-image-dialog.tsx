'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useCatalogueImage } from '@/hooks/use-image-catalog';

/**
 * Catalogue a source nobody here has built from yet.
 *
 * The counterpart to **Describe**, which registers a source the platform
 * already built and can therefore describe entirely on its own. Here nothing
 * has been built, so the repository and Dockerfile are typed rather than
 * derived — they are the entry's key ([ADR-0022](../../../docs/adr/0022-image-catalog.md)
 * decision 1), which is why they are asked for here and are not editable
 * afterwards.
 *
 * The row lands with no versions. That is the honest state — a catalog entry
 * is an offer, and nothing has built the image yet — and **Build** on the new
 * card is what gives it one.
 */

/** The repo's last path segment: `git@github.com:Appsilon/tealflow.git` →
 *  `tealflow`. The same suggestion a discovered entry arrives with, so an entry
 *  added by hand and one the platform found are named alike. */
function suggestedName(repo: string): string {
  const withoutTrailingSlash = repo.trim().replace(/\/+$/, '');
  return (withoutTrailingSlash.split('/').pop() ?? withoutTrailingSlash).replace(/\.git$/, '');
}

export function AddImageDialog({
  handle,
  open,
  onOpenChange,
}: {
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [repo, setRepo] = useState('');
  const [dockerfile, setDockerfile] = useState('');
  const [name, setName] = useState('');
  // Once someone types a name, the repo stops overwriting it — a suggestion
  // that keeps reasserting itself is a field you cannot fill in.
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');
  const catalogue = useCatalogueImage(handle);

  const effectiveName = nameEdited ? name : suggestedName(repo);

  // `mutate`, not `mutateAsync`: an async submit handler whose promise rejects
  // has nothing to catch it, so a rejected write both renders below and escapes
  // as an unhandled rejection. The error still lands in `catalogue.error`.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    catalogue.mutate(
      {
        name: effectiveName.trim(),
        intent: intent.trim(),
        // The empty string is a value, not an absence: it is what the entry is
        // keyed on for a source that names no Dockerfile.
        source: { kind: 'built', repo: repo.trim(), dockerfile: dockerfile.trim() },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (catalogue.isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add an image</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Catalogue a repository and Dockerfile @{handle} builds its image from. Nothing is
                built yet — the entry appears with no versions, and <strong>Build</strong> on its
                card makes the first one.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={catalogue.isPending}
                className="rounded-sm p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="add-image-repo" className="text-sm font-medium">
                Repository
              </label>
              <input
                id="add-image-repo"
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

            <div className="space-y-1.5">
              <label htmlFor="add-image-dockerfile" className="text-sm font-medium">
                Dockerfile <span className="text-muted-foreground">(optional)</span>
              </label>
              <input
                id="add-image-dockerfile"
                value={dockerfile}
                onChange={(event) => setDockerfile(event.target.value)}
                placeholder="container/Dockerfile"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for the repository&apos;s default. Two Dockerfiles in one repository are
                two entries, because they are two images.
              </p>
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">
                  The build context is the directory the Dockerfile is in.
                </strong>{' '}
                Everything it <code>COPY</code>s must sit beside it, so a Dockerfile in{' '}
                <code>container/</code> cannot reach files in the directory above.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="add-image-name" className="text-sm font-medium">
                Name
              </label>
              <input
                id="add-image-name"
                value={effectiveName}
                onChange={(event) => {
                  setNameEdited(true);
                  setName(event.target.value);
                }}
                required
                className="w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Suggested from the repository. Rename it to what your team calls this image.
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="add-image-intent" className="text-sm font-medium">
                Intent
              </label>
              <textarea
                id="add-image-intent"
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

            {catalogue.error !== null && (
              <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {catalogue.error.message}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={catalogue.isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={
                  catalogue.isPending || repo.trim() === '' || effectiveName.trim() === '' || intent.trim() === ''
                }
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {catalogue.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {catalogue.isPending ? 'Adding…' : 'Add to the catalog'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
