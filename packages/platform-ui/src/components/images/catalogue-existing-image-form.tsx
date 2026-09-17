'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { useCatalogueImage, useImageCatalogEntries } from '@/hooks/use-image-catalog';
import { useDockerImages } from '@/hooks/use-docker-images';
import { NewEntryFields } from './referenced-image-fields';

const INPUT_CLASS =
  'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** The repo's last path segment, the same suggestion `AddImageDialog` offers. */
function suggestedName(repository: string): string {
  return repository.split('/').pop() ?? repository;
}

/** One daemon repository, with every tag it currently carries. A `referenced`
 *  entry is keyed on the repository alone — every tag it has, now or later, is
 *  one of its versions (`resolveEntryVersions`) — so the picker offers one row
 *  per repository, not one per tag. */
interface RepositoryCandidate {
  repository: string;
  tags: string[];
}

function groupByRepository(images: readonly DockerImageInfo[]): RepositoryCandidate[] {
  const byRepository = new Map<string, string[]>();
  for (const image of images) {
    const tags = byRepository.get(image.repository) ?? [];
    tags.push(image.tag);
    byRepository.set(image.repository, tags);
  }
  return Array.from(byRepository, ([repository, tags]) => ({ repository, tags }));
}

/**
 * Catalogue an image the daemon already holds, with no rebuild — a
 * `referenced` source naming the repository as it stands. This is what the
 * catalog's `referenced` kind is for: an image the platform holds no build
 * inputs for (ADR-0022). The entry is keyed on the repository, not one tag —
 * every tag the daemon has for it, including ones added later, resolves as
 * one of its versions.
 *
 * With `image` set (Admin → Infrastructure, one row with no catalog match),
 * the repository is fixed to that row's. Without it (Images tab), every
 * daemon repository no `referenced` entry already claims is offered.
 */
export function CatalogueExistingImageForm({
  handle,
  image,
  onDone,
  onCancel,
  onPendingChange,
}: {
  handle: string;
  image?: DockerImageInfo;
  onDone: () => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { images, isAvailable, isLoading: imagesLoading } = useDockerImages();
  const { entries } = useImageCatalogEntries(handle);
  const catalogue = useCatalogueImage(handle);

  const referencedRepositories = useMemo(
    () =>
      new Set(
        entries
          .filter((entry) => entry.source.kind === 'referenced')
          .map((entry) => (entry.source as { reference: string }).reference),
      ),
    [entries],
  );
  const candidates = useMemo(
    () =>
      image !== undefined
        ? [{ repository: image.repository, tags: [image.tag] }]
        : groupByRepository(images).filter(
            (candidate) => referencedRepositories.has(candidate.repository) === false,
          ),
    [image, images, referencedRepositories],
  );

  const [selectedRepository, setSelectedRepository] = useState<string | null>(
    image !== undefined ? image.repository : null,
  );
  const selected = candidates.find((candidate) => candidate.repository === selectedRepository) ?? null;

  const [name, setName] = useState('');
  // Once someone types a name, picking a different image stops overwriting it.
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');

  const effectiveName = nameEdited ? name : selected !== null ? suggestedName(selected.repository) : '';
  const pending = catalogue.isPending;
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  // `mutate`, not `mutateAsync`, for the reason the other image dialogs give: a
  // rejected write renders below instead of escaping as an unhandled rejection.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (selected === null) return;
    catalogue.mutate(
      {
        name: effectiveName.trim(),
        intent: intent.trim(),
        source: { kind: 'referenced', reference: selected.repository },
      },
      { onSuccess: onDone },
    );
  }

  if (image === undefined && isAvailable === false) {
    return (
      <p className="text-sm text-muted-foreground">
        Docker info unavailable — the container worker is not reachable, or local agent mode is not
        enabled.
      </p>
    );
  }

  if (image === undefined && imagesLoading === false && candidates.length === 0) {
    return <p className="text-sm text-muted-foreground">Every image on the daemon already has a catalog entry.</p>;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {image !== undefined ? (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Image</p>
          <p className="mt-0.5 break-all font-mono text-xs">
            {image.repository}:{image.tag}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Catalogues every tag <code>{image.repository}</code> has on the daemon, not just this one.
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label htmlFor="catalogue-existing-image" className="text-sm font-medium">
            Image
          </label>
          <select
            id="catalogue-existing-image"
            value={selectedRepository ?? ''}
            onChange={(event) => {
              setSelectedRepository(event.target.value === '' ? null : event.target.value);
              setNameEdited(false);
            }}
            required
            className={`${INPUT_CLASS} font-mono`}
          >
            <option value="" disabled>
              {imagesLoading ? 'Loading…' : 'Choose an image'}
            </option>
            {candidates.map((candidate) => (
              <option key={candidate.repository} value={candidate.repository}>
                {candidate.repository}
                {candidate.tags.length === 1 ? `:${candidate.tags[0]}` : ` (${candidate.tags.length} tags)`}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            Every repository the daemon holds that no entry describes yet. Every tag it has becomes a
            version.
          </p>
        </div>
      )}

      <NewEntryFields
        idPrefix="catalogue-existing-image"
        name={effectiveName}
        onNameChange={(value) => {
          setNameEdited(true);
          setName(value);
        }}
        intent={intent}
        onIntentChange={setIntent}
        intentPlaceholder="Pulled by hand for the demo, kept around for the walkthrough"
      />

      {catalogue.error !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {catalogue.error.message}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border px-4 py-2 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending || selected === null || effectiveName.trim() === '' || intent.trim() === ''}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending ? 'Adding…' : 'Add to the catalog'}
        </button>
      </div>
    </form>
  );
}
