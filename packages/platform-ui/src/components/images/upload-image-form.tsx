'use client';

import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  buildContextDockerfileProblem,
  checkBuildContextArchive,
  checkBuildContextSize,
  formatBytes,
  toSlug,
} from '@mediforce/platform-core';
import { useImageCatalogEntries, useUploadImageVersion } from '@/hooks/use-image-catalog';
import { describeBuildFailure } from './build-error';
import { BuildFailureNotice } from './build-failure-notice';
import { ContextTree } from './context-tree';
import {
  contextSelection,
  dockerfileCandidates,
  packPickedFiles,
  readDirectoryHandle,
  readDockerignores,
  readPickedFolder,
  type PickableDirectory,
  selectedFiles,
  summarizeContext,
  toggleContextPath,
  type PickedFolder,
} from './picked-folder';
import {
  INPUT_CLASS,
  ImageNameField,
  ImageTagField,
  NewEntryFields,
  referencedEntryFor,
} from './referenced-image-fields';

/** Chromium's directory picker, missing from Firefox, Safari and the DOM lib. */
type DirectoryPicker = (options: { mode: 'read' }) => Promise<PickableDirectory>;

function directoryPicker(): DirectoryPicker | null {
  if (typeof window === 'undefined') return null;
  const picker = (window as Window & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker;
  return typeof picker === 'function' ? picker.bind(window) : null;
}

/**
 * Build an image from a folder on the member's machine, uploaded whole as the
 * build context (#1345). The first upload of a name creates its referenced
 * entry and asks what it is for; a later one asks only for the folder (ADR-0022).
 */
export function UploadImageForm({
  handle,
  fixedReference,
  onDone,
  onCancel,
  onPendingChange,
}: {
  handle: string;
  /** Set when adding a version to an entry that exists — the name is fixed. */
  fixedReference?: string;
  onDone: () => void;
  onCancel: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const [folder, setFolder] = useState<PickedFolder | null>(null);
  // Tied to the folder they were read from, so a slow read of an earlier pick
  // never lands on a later one.
  const [dockerignores, setDockerignores] = useState<{
    folder: PickedFolder;
    texts: ReadonlyMap<string, string>;
  } | null>(null);
  const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());
  const [pickedNothing, setPickedNothing] = useState(false);
  const [dockerfile, setDockerfile] = useState('');
  const [imageName, setImageName] = useState('');
  // Once someone types a name, the folder stops overwriting it.
  const [imageNameEdited, setImageNameEdited] = useState(false);
  const [tag, setTag] = useState('');
  const [name, setName] = useState('');
  const [nameEdited, setNameEdited] = useState(false);
  const [intent, setIntent] = useState('');
  const [declaredOpen, setDeclaredOpen] = useState(false);
  const [declared, setDeclared] = useState({ repo: '', commit: '', dockerfile: '' });
  const [packing, setPacking] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  const [pickDirectory] = useState(directoryPicker);
  const [readingFolder, setReadingFolder] = useState(false);
  const upload = useUploadImageVersion(handle);
  const { entries } = useImageCatalogEntries(handle);

  const pending = packing || upload.isPending;
  useEffect(() => onPendingChange(pending), [pending, onPendingChange]);

  const effectiveImageName = imageNameEdited ? imageName : toSlug(folder?.name ?? '');
  const reference = fixedReference ?? `${handle}/${effectiveImageName}`;
  const existing = referencedEntryFor(entries, reference);
  const addsToEntry = fixedReference !== undefined || existing !== undefined;
  const effectiveName = nameEdited ? name : effectiveImageName;

  const candidates = folder === null ? [] : dockerfileCandidates(folder);
  const ignoreTexts = folder !== null && dockerignores?.folder === folder ? dockerignores.texts : null;
  const initialSelection = useMemo(
    () => (folder === null || ignoreTexts === null ? null : contextSelection(folder, ignoreTexts, dockerfile)),
    [folder, ignoreTexts, dockerfile],
  );
  const selection = useMemo(
    () => (initialSelection === null ? null : { ...initialSelection, unchecked }),
    [initialSelection, unchecked],
  );
  const summaries = useMemo(
    () => (folder === null || selection === null ? null : summarizeContext(folder, selection)),
    [folder, selection],
  );
  const whole = summaries?.get('');
  const uploading = useMemo(
    () => (folder === null || selection === null ? [] : selectedFiles(folder, selection)),
    [folder, selection],
  );
  const size = useMemo(
    () =>
      whole === undefined
        ? null
        : checkBuildContextSize(whole.selectedBytes, uploading.map(({ path, file }) => ({ path, size: file.size }))),
    [whole, uploading],
  );
  const uploadSummary =
    whole === undefined
      ? ''
      : [
          `Uploading ${whole.selectedFiles} of ${whole.files} file${whole.files === 1 ? '' : 's'}, ${formatBytes(whole.selectedBytes)}`,
          whole.ignoredFiles > 0 ? `${whole.ignoredFiles} left out by ${selection?.ignoreFile}` : '',
          whole.uncheckedFiles > 0 ? `${whole.uncheckedFiles} unchecked` : '',
        ]
          .filter((part) => part !== '')
          .join(' · ');
  const pathProblem =
    folder === null ? null : buildContextDockerfileProblem(dockerfile, folder.files.map((picked) => picked.path));
  const failure =
    upload.error === null ? null : describeBuildFailure(upload.error.message, folder?.name, { browserUpload: true });

  async function pickFolder(picked: PickedFolder | null) {
    setFolder(picked);
    setUnchecked(new Set());
    setPickedNothing(picked === null);
    setDockerfile(picked === null ? '' : (dockerfileCandidates(picked)[0] ?? ''));
    setPackError(null);
    if (picked === null) return;
    try {
      setDockerignores({ folder: picked, texts: await readDockerignores(picked) });
    } catch (error) {
      setPackError(`Could not read the folder: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function chooseDirectory(picker: DirectoryPicker) {
    let directory: PickableDirectory;
    try {
      directory = await picker({ mode: 'read' });
    } catch (error) {
      // Closing the picker rejects with AbortError: nothing was chosen.
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPackError(`Could not open the folder: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    setReadingFolder(true);
    try {
      await pickFolder(await readDirectoryHandle(directory));
    } catch (error) {
      setPackError(`Could not read the folder: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setReadingFolder(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (folder === null) return;
    setPackError(null);
    setPacking(true);
    let archive: Uint8Array<ArrayBuffer>;
    try {
      archive = await packPickedFiles(uploading);
    } catch (error) {
      setPackError(`Could not read the folder: ${error instanceof Error ? error.message : String(error)}`);
      return;
    } finally {
      setPacking(false);
    }
    // The platform checks it again; this is so a context that cannot build
    // fails here, before minutes of uploading.
    const check = checkBuildContextArchive(archive, dockerfile);
    if (check.ok === false) {
      setPackError(check.message);
      return;
    }

    const declaredSource = Object.fromEntries(
      Object.entries(declared)
        .map(([key, value]) => [key, value.trim()])
        .filter(([, value]) => value !== ''),
    );
    // `mutate`, not `mutateAsync`, for the reason the other dialogs give: a
    // rejected build renders below instead of escaping as an unhandled rejection.
    upload.mutate(
      {
        reference,
        dockerfile: dockerfile.trim(),
        context: archive,
        ...(tag.trim() === '' ? {} : { tag: tag.trim() }),
        ...(addsToEntry || Object.keys(declaredSource).length === 0 ? {} : { declaredSource }),
        ...(addsToEntry ? {} : { name: effectiveName.trim(), intent: intent.trim() }),
      },
      { onSuccess: onDone },
    );
  }

  const canSubmit =
    pending === false &&
    folder !== null &&
    selection !== null &&
    size?.ok === true &&
    pathProblem === null &&
    effectiveImageName !== '' &&
    (addsToEntry || (effectiveName.trim() !== '' && intent.trim() !== ''));

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="upload-image-folder" className="text-sm font-medium">
          Folder
        </label>
        {pickDirectory !== null ? (
          <div>
            <button
              id="upload-image-folder"
              type="button"
              onClick={() => void chooseDirectory(pickDirectory)}
              disabled={pending || readingFolder}
              className="inline-flex items-center gap-1.5 rounded-md border bg-background px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
            >
              {readingFolder && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {readingFolder ? 'Reading the folder…' : folder === null ? 'Choose folder' : 'Choose another folder'}
            </button>
          </div>
        ) : (
          <input
            id="upload-image-folder"
            type="file"
            multiple
            // Not a React prop, so set on the element: it is what makes the
            // picker choose a folder rather than files.
            ref={(element) => {
              if (element !== null) element.webkitdirectory = true;
            }}
            onChange={(event) => void pickFolder(readPickedFolder(event.target.files ?? []))}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-background file:px-3 file:py-1.5 file:text-xs file:font-medium"
          />
        )}
        {folder !== null && (
          <p className="text-xs text-muted-foreground">
            {folder.name === '' ? 'Picked' : folder.name}: {folder.files.length} file
            {folder.files.length === 1 ? '' : 's'}, {formatBytes(folder.bytes)}
          </p>
        )}
        {pickedNothing && (
          <p className="text-xs text-destructive">
            No files were picked. Browsers leave empty folders out, so pick the folder that holds
            the Dockerfile.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          The folder is the build context: everything the Dockerfile <code>COPY</code>s is read
          from it. What its <code>.dockerignore</code> excludes is never uploaded.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="upload-image-dockerfile" className="text-sm font-medium">
          Dockerfile
        </label>
        <input
          id="upload-image-dockerfile"
          list="upload-image-dockerfiles"
          value={dockerfile}
          onChange={(event) => setDockerfile(event.target.value)}
          placeholder="Dockerfile"
          className={`${INPUT_CLASS} font-mono`}
        />
        <datalist id="upload-image-dockerfiles">
          {candidates.map((candidate) => (
            <option key={candidate} value={candidate} />
          ))}
        </datalist>
        {pathProblem !== null ? (
          <p className="text-xs text-destructive">{pathProblem}</p>
        ) : (
          <p className="text-xs text-muted-foreground">Relative to the folder</p>
        )}
      </div>

      {folder !== null && selection !== null && summaries !== null && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">Files to upload</p>
          <ContextTree
            folder={folder}
            selection={selection}
            summaries={summaries}
            onToggle={(path) => setUnchecked(toggleContextPath(folder, selection, path))}
          />
          <p className="text-xs text-muted-foreground">{uploadSummary}</p>
          {size?.ok === false ? (
            <p className="text-xs text-destructive">{size.message}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Uncheck what the Dockerfile does not <code>COPY</code>; the Dockerfile and the ignore
              file always go up.
            </p>
          )}
        </div>
      )}

      {fixedReference === undefined ? (
        <ImageNameField
          idPrefix="upload-image"
          handle={handle}
          value={effectiveImageName}
          onChange={(value) => {
            setImageNameEdited(true);
            setImageName(value);
          }}
          existing={existing}
        />
      ) : (
        <div className="rounded-md border bg-muted/30 px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Image</p>
          <p className="mt-0.5 break-all font-mono text-xs">{fixedReference}</p>
        </div>
      )}

      <ImageTagField idPrefix="upload-image" value={tag} onChange={setTag} placeholder="the upload time" />

      {addsToEntry === false && (
        <NewEntryFields
          idPrefix="upload-image"
          name={effectiveName}
          onNameChange={(value) => {
            setNameEdited(true);
            setName(value);
          }}
          intent={intent}
          onIntentChange={setIntent}
          intentPlaceholder="Runs the ADaM checks for studies with no repository"
        />
      )}

      {addsToEntry === false && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setDeclaredOpen((current) => !current)}
            aria-expanded={declaredOpen}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            {declaredOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Where it came from <span className="font-normal">(optional, declared)</span>
          </button>
          {declaredOpen && (
            <div className="space-y-2 rounded-md border bg-muted/20 p-3">
              <p className="text-xs text-muted-foreground">
                Shown on the entry as declared by a member, never as derived: the platform keeps
                nothing it could check this against.
              </p>
              {(
                [
                  ['repo', 'Declared repository', 'https://gitlab.example.com/team/agent'],
                  ['commit', 'Declared commit', 'bf0353b'],
                  ['dockerfile', 'Declared Dockerfile', 'container/Dockerfile'],
                ] as const
              ).map(([key, label, placeholder]) => (
                <div key={key} className="space-y-1">
                  <label htmlFor={`upload-image-declared-${key}`} className="text-xs font-medium">
                    {label}
                  </label>
                  <input
                    id={`upload-image-declared-${key}`}
                    value={declared[key]}
                    onChange={(event) => setDeclared((current) => ({ ...current, [key]: event.target.value }))}
                    placeholder={placeholder}
                    className={`${INPUT_CLASS} font-mono text-xs`}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        The platform does not keep the folder. To update the image later, upload it again.
      </p>

      {packError !== null && (
        <div className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {packError}
        </div>
      )}
      {failure !== null && <BuildFailureNotice failure={failure} />}

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
          {packing
            ? 'Reading the folder…'
            : upload.isPending
              ? 'Uploading and building — this takes minutes…'
              : 'Upload and build'}
        </button>
      </div>
    </form>
  );
}
