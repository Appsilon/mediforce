'use client';

import * as Dialog from '@radix-ui/react-dialog';
import { ChevronDown, ChevronRight, Loader2, X } from 'lucide-react';
import { useState } from 'react';
import { builtSourceLine } from '@mediforce/platform-core';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { useBuildImageVersion } from '@/hooks/use-image-catalog';
import { describeBuildFailure } from './build-error';

/**
 * Build one more version of an entry the workspace already offers.
 *
 * One field. The entry's source is `(repo, dockerfile, context)` — the build
 * recipe with the commit left out — so the commit is the only thing left to ask
 * for, and the source is shown rather than edited: changing it is **Edit**'s
 * job (ADR-0022 decision 1).
 */
export function BuildImageDialog({
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
  const [commit, setCommit] = useState('');
  const [showFullError, setShowFullError] = useState(false);
  const build = useBuildImageVersion(handle);
  const context = entry.source.kind === 'built' ? entry.source.context : undefined;
  const failure = build.error === null ? null : describeBuildFailure(build.error.message, context);

  if (entry.source.kind !== 'built') return null;
  const { repo, dockerfile } = entry.source;

  // `mutate`, not `mutateAsync`: an async submit handler whose promise rejects
  // has nothing to catch it, so a failed build both renders below and escapes
  // as an unhandled rejection. The error still lands in `build.error`.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    build.mutate(
      { repo, commit: commit.trim(), dockerfile, context },
      { onSuccess: () => onOpenChange(false) },
    );
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        // Closing mid-build would leave the only progress indicator with no
        // way back to it — the request is still running either way.
        if (build.isPending) return;
        onOpenChange(value);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-6 shadow-lg">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-lg font-semibold">Build a version</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-muted-foreground">
                Builds this source on the platform now, instead of waiting for a workflow run to
                build it. A step pinning the same commit will find it already built.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                disabled={build.isPending}
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
              <p className="mt-0.5 break-all font-mono text-xs">
                {builtSourceLine(repo, dockerfile, context)}
              </p>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="build-image-commit" className="text-sm font-medium">
                Commit
              </label>
              <input
                id="build-image-commit"
                value={commit}
                onChange={(event) => setCommit(event.target.value)}
                required
                placeholder="bf0353b123bee142100ae5605ec15ad7605ceb4f"
                className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                The commit to check out and build. It becomes this version&apos;s identity, which is
                why the entry keeps one row and gains a version rather than splitting in two.
              </p>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2">
              {context === undefined ? (
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">The build context is the Dockerfile&apos;s own
                  directory.</strong>{' '}
                  Everything the Dockerfile <code>COPY</code>s must sit beside it — one in{' '}
                  <code>container/</code> cannot reach files in the directory above unless the
                  entry sets a build context.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">
                    Built from the context <code>{context}</code>.
                  </strong>{' '}
                  Everything the Dockerfile <code>COPY</code>s is read from there, not from the
                  directory the Dockerfile sits in.
                </p>
              )}
            </div>

            {failure !== null && (
              <div className="space-y-2 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p className={failure.explained ? '' : 'break-all font-mono text-xs'}>
                  {failure.summary}
                </p>
                <button
                  type="button"
                  onClick={() => setShowFullError((current) => !current)}
                  aria-expanded={showFullError}
                  className="inline-flex items-center gap-1 text-xs font-medium underline-offset-2 hover:underline"
                >
                  {showFullError ? (
                    <ChevronDown className="h-3 w-3" />
                  ) : (
                    <ChevronRight className="h-3 w-3" />
                  )}
                  {showFullError ? 'Hide full error' : 'Show full error'}
                </button>
                {showFullError && (
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] leading-relaxed">
                    {failure.detail}
                  </pre>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                disabled={build.isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={build.isPending || commit.trim() === ''}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {build.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {build.isPending ? 'Building — this takes minutes…' : 'Build'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
