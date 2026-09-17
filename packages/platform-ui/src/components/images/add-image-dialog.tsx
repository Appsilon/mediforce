'use client';

import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import { Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { useCatalogueImage } from '@/hooks/use-image-catalog';
import { DockerfileAndContextFields } from './build-source-fields';
import { CatalogueExistingImageForm } from './catalogue-existing-image-form';
import { PullRegistryImageForm } from './pull-registry-image-form';
import { suggestedName } from './referenced-image-fields';
import { UploadImageForm } from './upload-image-form';

/**
 * Catalogue a source nobody here has built from yet.
 *
 * The counterpart to **Describe**, which registers a source the platform
 * already built and can therefore describe entirely on its own. Here nothing
 * has been built, so the repository, Dockerfile and build context are typed
 * rather than derived — the first two are the entry's key
 * ([ADR-0022](../../../docs/adr/0022-image-catalog.md) decision 1), and the
 * context is how its **Build** action builds it.
 *
 * The row lands with no versions. That is the honest state — a catalog entry
 * is an offer, and nothing has built the image yet — and **Build** on the new
 * card is what gives it one.
 *
 * **Local folder** uploads a folder and builds it at once instead (#1345).
 * **Existing image** catalogues one the daemon already holds; Admin →
 * Infrastructure opens the dialog there, on the row it was opened from.
 * **Registry image** pulls one onto the daemon first.
 */

export function AddImageDialog({
  handle,
  open,
  onOpenChange,
  initialMode = 'repository',
  initialRepository,
}: {
  handle: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMode?: 'repository' | 'folder' | 'existing' | 'registry';
  /** The daemon repository the **Existing image** tab starts on. */
  initialRepository?: string;
}) {
  const [repo, setRepo] = useState('');
  const [dockerfile, setDockerfile] = useState('');
  const [context, setContext] = useState('');
  const [name, setName] = useState('');
  // Once someone types a name, the repo stops overwriting it — a suggestion
  // that keeps reasserting itself is a field you cannot fill in.
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');
  const [mode, setMode] = useState<string>(initialMode);
  // Shared by the other tabs, which submit through their own mutation rather
  // than `catalogue` — this dialog's chrome only needs to know whether any of
  // them is mid-submit.
  const [otherTabPending, setOtherTabPending] = useState(false);
  const catalogue = useCatalogueImage(handle);
  const pending = catalogue.isPending || otherTabPending;

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
        source: {
          kind: 'built',
          repo: repo.trim(),
          dockerfile: dockerfile.trim(),
          context: context.trim() === '' ? undefined : context.trim(),
        },
      },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (pending === true) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Add an image</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                {mode === 'repository' ? (
                  <>
                    Catalogue a repository and Dockerfile @{handle} builds its image from. Nothing
                    is built yet — the entry appears with no versions, and <strong>Build</strong> on
                    its card makes the first one.
                  </>
                ) : mode === 'folder' ? (
                  <>
                    Upload a folder with a Dockerfile and build it now — for an image whose
                    Dockerfile is in no repository the platform can reach.
                  </>
                ) : mode === 'registry' ? (
                  <>
                    Pull an image from a registry onto the deployment and catalogue it — no host shell
                    needed. A later tag of the same image adds a version.
                  </>
                ) : (
                  <>
                    Catalogue an image the daemon already holds — no build, for one that was pulled or
                    built by hand and has no recipe the platform can rebuild it from.
                  </>
                )}
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

          <Tabs.Root value={mode} onValueChange={setMode}>
            <Tabs.List
              aria-label="Build from"
              className="mb-4 grid grid-cols-2 gap-1 rounded-md border bg-muted/30 p-1 sm:grid-cols-4"
            >
              {(
                [
                  ['repository', 'Git repository'],
                  ['folder', 'Local folder'],
                  ['existing', 'Existing image'],
                  ['registry', 'Registry image'],
                ] as const
              ).map(([value, label]) => (
                <Tabs.Trigger
                  key={value}
                  value={value}
                  disabled={pending}
                  className="rounded px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm"
                >
                  {label}
                </Tabs.Trigger>
              ))}
            </Tabs.List>

            <Tabs.Content value="folder">
              <UploadImageForm
                handle={handle}
                onDone={() => onOpenChange(false)}
                onCancel={() => onOpenChange(false)}
                onPendingChange={setOtherTabPending}
              />
            </Tabs.Content>

            <Tabs.Content value="registry">
              <PullRegistryImageForm
                handle={handle}
                onDone={() => onOpenChange(false)}
                onCancel={() => onOpenChange(false)}
                onPendingChange={setOtherTabPending}
              />
            </Tabs.Content>

            <Tabs.Content value="existing">
              <CatalogueExistingImageForm
                handle={handle}
                initialRepository={initialRepository}
                onDone={() => onOpenChange(false)}
                onCancel={() => onOpenChange(false)}
                onPendingChange={setOtherTabPending}
              />
            </Tabs.Content>

            <Tabs.Content value="repository">
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

                <DockerfileAndContextFields
                  idPrefix="add-image"
                  dockerfile={dockerfile}
                  onDockerfileChange={setDockerfile}
                  context={context}
                  onContextChange={setContext}
                />

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
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="add-image-intent" className="text-sm font-medium">
                    Description
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
            </Tabs.Content>
          </Tabs.Root>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
