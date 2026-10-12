'use client';

import * as React from 'react';
import { FolderUp, Upload } from 'lucide-react';
import { z } from 'zod';
import {
  WorkflowArtifactSchema,
  validateArtifacts,
  type WorkflowArtifact,
} from '@mediforce/platform-core';
import { TextFilesPane } from '@/components/files/text-files-pane';
import { entriesFromDrop, entriesFromFiles, uploadPathFor, type UploadedEntry } from '@/lib/folder-upload';
import { decodeTextFile, mergeUploadedFiles, type RejectedUpload } from '@/lib/workflow-file-uploads';

/** The server's own rule, run on the draft: one implementation decides whether
 *  a set of files is registerable, so the panel cannot say yes to something the
 *  save then refuses. */
const ArtifactSetSchema = z
  .object({ artifacts: z.array(WorkflowArtifactSchema).optional() })
  .superRefine(validateArtifacts);

function firstIssue(artifacts: WorkflowArtifact[]): string | null {
  const result = ArtifactSetSchema.safeParse({ artifacts });
  return result.success ? null : (result.error.issues[0]?.message ?? 'These files cannot be saved.');
}

/**
 * The files this workflow carries: a script a step runs, a Dockerfile its image
 * is built from, a SKILL.md an agent reads. They save with the next version and
 * appear in the container at `/artifacts`, so a workflow written here needs no
 * repository and no checkout to run.
 */
export function WorkflowFilesPanel({
  artifacts,
  onChange,
}: {
  artifacts: WorkflowArtifact[];
  onChange: (next: WorkflowArtifact[]) => void;
}) {
  const [selected, setSelected] = React.useState(0);
  const [rejected, setRejected] = React.useState<RejectedUpload[]>([]);
  const filePickerRef = React.useRef<HTMLInputElement>(null);
  const folderPickerRef = React.useRef<HTMLInputElement>(null);

  /** Folds in what was picked or dropped. Text only: anything else is refused
   *  with a reason rather than stored mangled. `read` is called before the
   *  first await: a drop's entries are only readable while its event is live. */
  const upload = async (read: () => Promise<UploadedEntry[]>): Promise<void> => {
    const entries = await read();
    const reads = entries.map((entry) => ({ path: uploadPathFor(entry.path), text: decodeTextFile(entry.bytes) }));

    const notText = reads.filter((entry) => entry.text === null);
    const merged = mergeUploadedFiles(
      artifacts,
      reads.flatMap((entry) => (entry.text === null ? [] : [{ path: entry.path, contents: entry.text }])),
    );
    setRejected([
      ...notText.map((entry) => ({ path: entry.path, reason: 'not a text file' })),
      ...merged.rejected,
    ]);
    if (merged.artifacts.length > artifacts.length) setSelected(artifacts.length);
    onChange(merged.artifacts);
  };

  const issue = firstIssue(artifacts);

  return (
    <TextFilesPane
      files={artifacts}
      onChange={onChange}
      readOnly={false}
      selected={selected}
      onSelect={setSelected}
      onDrop={(items) => void upload(() => entriesFromDrop(items))}
      pathPlaceholder="scripts/poll.py"
      listLabel="Workflow files"
      emptyHint={
        <>
          No files yet. Add, upload or drop them here — a script a step runs
          (read from <code className="font-mono">/artifacts</code>), a
          Dockerfile to build its image, or a skills folder an agent step can
          then pick.
        </>
      }
      actions={
        <>
          <button
            type="button"
            aria-label="Upload files"
            title="Upload files"
            onClick={() => filePickerRef.current?.click()}
            className="inline-flex items-center rounded-md border p-1 transition-colors hover:bg-muted"
          >
            <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Upload a folder"
            title="Upload a folder, keeping its structure"
            onClick={() => folderPickerRef.current?.click()}
            className="inline-flex items-center rounded-md border p-1 transition-colors hover:bg-muted"
          >
            <FolderUp className="h-3.5 w-3.5" />
          </button>
          <input
            ref={filePickerRef}
            type="file"
            multiple
            aria-label="Files to upload"
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) void upload(() => entriesFromFiles(files));
            }}
          />
          <input
            ref={folderPickerRef}
            type="file"
            multiple
            aria-label="Folder to upload"
            className="hidden"
            // Not in React's JSX types, and the picker is the only way to keep an
            // uploaded folder's structure.
            {...{ webkitdirectory: '', directory: '' } as Record<string, string>}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (files.length > 0) void upload(() => entriesFromFiles(files));
            }}
          />
        </>
      }
      fileNote={(file) => (
        <p className="text-[11px] text-muted-foreground">
          Inside a run this file is <code className="font-mono">/artifacts/{file.path}</code>.
        </p>
      )}
      footer={
        <>
          {rejected.length > 0 && (
            <ul className="space-y-0.5 text-xs text-destructive">
              {rejected.map((entry) => (
                <li key={entry.path}>
                  <span className="font-mono">{entry.path}</span> was not added: {entry.reason}.
                  {entry.reason === 'not a text file' && ' A workflow carries text, so put binaries in an image or a repository.'}
                </li>
              ))}
            </ul>
          )}
          {issue !== null && <p className="text-xs text-destructive">{issue}</p>}
        </>
      }
    />
  );
}
