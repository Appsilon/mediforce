'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DockerImageInfo } from '@mediforce/platform-api/contract';
import { useCatalogueImage, useImageCatalogEntries } from '@/hooks/use-image-catalog';
import { useDockerImages } from '@/hooks/use-docker-images';
import { INPUT_CLASS, NewEntryFields, suggestedName } from './referenced-image-fields';

/**
 * Whether the platform built this image from a source it can describe — a repo
 * or a workflow's carried files. Such an image is a version of a discovered
 * entry already, and cataloguing its repository as `referenced` would claim
 * every tag in it, `mediforce-built` and `mediforce-artifacts` included, which
 * are shared by every workspace.
 */
export function isPlatformBuilt(image: DockerImageInfo): boolean {
  return image.buildRepo !== undefined || image.buildArtifacts !== undefined;
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
  const platformBuilt = new Set(images.filter(isPlatformBuilt).map((image) => image.repository));
  const byRepository = new Map<string, string[]>();
  for (const image of images) {
    if (platformBuilt.has(image.repository)) continue;
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
 * Every daemon repository no `referenced` entry already claims, and the
 * platform did not build, is offered. `initialRepository` starts on one — Admin
 * → Infrastructure's `+` on a row with no catalog match.
 */
export function CatalogueExistingImageForm({
  handle,
  initialRepository,
  onDone,
  onCancel,
  onPendingChange,
}: {
  handle: string;
  initialRepository?: string;
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
        entries.flatMap((entry) => (entry.source.kind === 'referenced' ? [entry.source.reference] : [])),
      ),
    [entries],
  );
  const candidates = useMemo(
    () =>
      groupByRepository(images).filter(
        (candidate) => referencedRepositories.has(candidate.repository) === false,
      ),
    [images, referencedRepositories],
  );

  const [selectedRepository, setSelectedRepository] = useState<string | null>(initialRepository ?? null);
  const selected = candidates.find((candidate) => candidate.repository === selectedRepository) ?? null;

  const [name, setName] = useState('');
  // Once someone types a name, picking a different image stops overwriting it.
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');

  const effectiveName = nameEdited === true ? name : selected !== null ? suggestedName(selected.repository) : '';
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

  if (isAvailable === false) {
    return (
      <p className="text-sm text-muted-foreground">
        Docker info unavailable — the container worker is not reachable, or local agent mode is not
        enabled.
      </p>
    );
  }

  if (imagesLoading === false && candidates.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nothing to add: every image on the daemon is either catalogued by its repository already or built by the
        platform, which offers it on its own.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
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
            {imagesLoading === true ? 'Loading…' : 'Choose an image'}
          </option>
          {candidates.map((candidate) => (
            <option key={candidate.repository} value={candidate.repository}>
              {candidate.repository}
              {candidate.tags.length === 1 ? `:${candidate.tags[0]}` : ` (${candidate.tags.length} tags)`}
            </option>
          ))}
        </select>
        <p className="text-xs text-muted-foreground">
          Every repository the daemon holds that no entry describes and the platform did not build.
          Every tag it has becomes a version.
        </p>
      </div>

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
