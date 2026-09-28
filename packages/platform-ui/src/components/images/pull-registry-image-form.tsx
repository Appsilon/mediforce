'use client';

import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { daemonRepositoryName } from '@mediforce/platform-core';
import { useImageCatalogEntries, usePullImageVersion } from '@/hooks/use-image-catalog';
import {
  INPUT_CLASS,
  ImageTagField,
  NewEntryFields,
  referencedEntryFor,
  suggestedName,
} from './referenced-image-fields';

/**
 * Pull an image from a registry onto the daemon and catalogue it, with no host
 * shell — the browser half of `mediforce images pull`. The first pull of a
 * reference creates its `referenced` entry and asks what it is for; a later tag
 * of the same reference only adds a version (ADR-0022).
 *
 * A private registry still needs `docker login` on the host: the platform holds
 * no registry credentials, so it can only pull what the daemon can already reach.
 */
export function PullRegistryImageForm({
  handle,
  onDone,
  onCancel,
  onPendingChange,
}: {
  handle: string;
  onDone: () => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [reference, setReference] = useState('');
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  // Once someone types a name, editing the reference stops overwriting it.
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');
  const pull = usePullImageVersion(handle);
  const { entries } = useImageCatalogEntries(handle);

  const trimmedReference = reference.trim();
  // Matched the way the handler keys it, so `docker.io/library/python` finds
  // the entry the daemon lists as `python`.
  const existing =
    trimmedReference === '' ? undefined : referencedEntryFor(entries, daemonRepositoryName(trimmedReference));
  const effectiveName = nameEdited ? name : suggestedName(trimmedReference);
  const pending = pull.isPending;
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  const canSubmit =
    pending === false &&
    trimmedReference !== '' &&
    (existing !== undefined || (effectiveName.trim() !== '' && intent.trim() !== ''));

  // `mutate`, not `mutateAsync`, for the reason the other image dialogs give: a
  // rejected write renders below instead of escaping as an unhandled rejection.
  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (canSubmit === false) return;
    pull.mutate(
      {
        reference: trimmedReference,
        ...(tag.trim() === '' ? {} : { tag: tag.trim() }),
        ...(existing === undefined ? { name: effectiveName.trim(), intent: intent.trim() } : {}),
      },
      { onSuccess: onDone },
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="pull-image-reference" className="text-sm font-medium">
          Image reference
        </label>
        <input
          id="pull-image-reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          required
          placeholder="ghcr.io/acme/sdtm-agent"
          className={`${INPUT_CLASS} font-mono`}
        />
        <p className="text-xs text-muted-foreground">
          {existing !== undefined ? (
            <>
              Adds a version to <strong className="text-foreground">{existing.name}</strong>.
            </>
          ) : (
            <>
              A registry image with no tag — <code>rocker/r-ver</code>, <code>ghcr.io/org/image</code>. The
              deployment pulls it; a private registry needs an administrator to log the host in first.
            </>
          )}
        </p>
      </div>

      <ImageTagField idPrefix="pull-image" value={tag} onChange={setTag} placeholder="latest" />

      {existing === undefined && (
        <NewEntryFields
          idPrefix="pull-image"
          name={effectiveName}
          onNameChange={(value) => {
            setNameEdited(true);
            setName(value);
          }}
          intent={intent}
          onIntentChange={setIntent}
          intentPlaceholder="Plain R runtime for script steps that need no agent"
        />
      )}

      {pull.error !== null && (
        <div className="whitespace-pre-wrap break-words rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {pull.error.message}
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
          disabled={canSubmit === false}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {pending ? 'Pulling — this can take minutes…' : 'Pull and add'}
        </button>
      </div>
    </form>
  );
}
