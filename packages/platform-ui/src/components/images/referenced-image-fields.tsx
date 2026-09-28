'use client';

import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';

export const INPUT_CLASS =
  'w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** The last path segment of a repository: `git@github.com:Appsilon/tealflow.git`
 *  or `registry.example.com/tealflow` → `tealflow`. The same suggestion a
 *  discovered entry arrives with, so an entry added by hand and one the
 *  platform found are named alike. */
export function suggestedName(repository: string): string {
  const withoutTrailingSlash = repository.trim().replace(/\/+$/, '');
  return (withoutTrailingSlash.split('/').pop() ?? withoutTrailingSlash).replace(/\.git$/, '');
}

/**
 * The referenced entry a reference already names. A build under it adds a
 * version, so it asks for no name or sentence; otherwise it creates the entry
 * and must say what the image is for (ADR-0022).
 */
export function referencedEntryFor(
  entries: readonly ImageCatalogEntryView[],
  reference: string,
): ImageCatalogEntryView | undefined {
  return entries.find(
    (entry) => entry.source.kind === 'referenced' && entry.source.reference === reference,
  );
}

/**
 * The image name, under the workspace's own prefix. **Upload** and **Publish
 * as image** both build into a referenced entry, with the same naming rules, so
 * one component states them.
 */
export function ImageNameField({
  idPrefix,
  handle,
  value,
  onChange,
  existing,
}: {
  idPrefix: string;
  handle: string;
  value: string;
  onChange: (value: string) => void;
  existing: ImageCatalogEntryView | undefined;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-reference`} className="text-sm font-medium">
        Image name
      </label>
      <div className="flex items-center rounded-md border bg-background focus-within:ring-2 focus-within:ring-ring">
        <span className="select-none pl-3 font-mono text-sm text-muted-foreground">{handle}/</span>
        <input
          id={`${idPrefix}-reference`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          placeholder="my-agent"
          className="min-w-0 flex-1 bg-transparent py-2 pr-3 font-mono text-sm focus:outline-none"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        {existing !== undefined ? (
          <>
            Adds a version to <strong className="text-foreground">{existing.name}</strong>.
          </>
        ) : (
          <>Starts with @{handle}: every workspace builds on one shared Docker daemon.</>
        )}
      </p>
    </div>
  );
}

export function ImageTagField({
  idPrefix,
  value,
  onChange,
  placeholder,
}: {
  idPrefix: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-tag`} className="text-sm font-medium">
        Tag <span className="text-muted-foreground">(optional)</span>
      </label>
      <input
        id={`${idPrefix}-tag`}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={`${INPUT_CLASS} font-mono`}
      />
      <p className="text-xs text-muted-foreground">
        A tag already on the daemon is refused — a workflow pinning it would start running
        something else.
      </p>
    </div>
  );
}

/** The two things a new referenced entry needs a human to write. */
export function NewEntryFields({
  idPrefix,
  name,
  onNameChange,
  intent,
  onIntentChange,
  intentPlaceholder,
}: {
  idPrefix: string;
  name: string;
  onNameChange: (value: string) => void;
  intent: string;
  onIntentChange: (value: string) => void;
  intentPlaceholder: string;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-name`} className="text-sm font-medium">
          Name
        </label>
        <input
          id={`${idPrefix}-name`}
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          required
          className={INPUT_CLASS}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-intent`} className="text-sm font-medium">
          Description
        </label>
        <textarea
          id={`${idPrefix}-intent`}
          value={intent}
          onChange={(event) => onIntentChange(event.target.value)}
          required
          rows={2}
          placeholder={intentPlaceholder}
          className={INPUT_CLASS}
        />
      </div>
    </>
  );
}
