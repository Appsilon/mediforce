'use client';

import * as React from 'react';
import { FileCode, FolderUp, GitBranch, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import * as Dialog from '@radix-ui/react-dialog';
import { z } from 'zod';
import type { WorkflowStep } from '@mediforce/platform-core';
import {
  WorkflowArtifactSchema,
  WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES,
  validateArtifacts,
  type WorkflowArtifact,
} from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { CodeEditor } from './workflow-editor/code-editor';
import { decodeTextFile, mergeUploadedFiles, uploadPathFor, type RejectedUpload } from '@/lib/workflow-file-uploads';
import { mediforceSilent } from '@/lib/mediforce';
import { repoBackedFiles, isAlreadyCarried, takeOverFiles, type RepoBackedFile } from '@/lib/repo-backed-steps';

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

function totalBytes(artifacts: WorkflowArtifact[]): number {
  const encoder = new TextEncoder();
  return artifacts.reduce(
    (sum, artifact) => sum + encoder.encode(artifact.path).length + encoder.encode(artifact.contents).length,
    0,
  );
}

function formatBytes(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} B` : `${(bytes / 1024).toFixed(1)} KB`;
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
  steps = [],
  workflowName,
  namespace,
}: {
  artifacts: WorkflowArtifact[];
  onChange: (next: WorkflowArtifact[]) => void;
  /** Steps are read only to find the ones that build from a repository. */
  steps?: WorkflowStep[];
  workflowName?: string;
  namespace?: string;
}) {
  /** One selection: a file the workflow carries, or one read from a repository. */
  type Selection =
    | { kind: 'carried'; index: number }
    | { kind: 'repo'; stepId: string; path: string };
  const [selection, setSelection] = React.useState<Selection>({ kind: 'carried', index: 0 });
  const [repoFiles, setRepoFiles] = React.useState<Record<string, {
    status: 'loading' | 'loaded' | 'error';
    repo?: string;
    commit?: string;
    files?: { path: string; contents: string; truncated?: boolean }[];
    error?: string;
  }>>({});
  const [confirmingTakeover, setConfirmingTakeover] = React.useState(false);
  const [newPath, setNewPath] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [rejected, setRejected] = React.useState<RejectedUpload[]>([]);
  const [dropping, setDropping] = React.useState(false);
  const filePickerRef = React.useRef<HTMLInputElement>(null);
  const folderPickerRef = React.useRef<HTMLInputElement>(null);

  /** Reads what was picked or dropped and folds it in. Text only: anything else
   *  is refused with a reason rather than stored mangled. */
  const upload = async (files: File[], droppedFolderName?: string): Promise<void> => {
    const reads = await Promise.all(files.map(async (file) => {
      const path = uploadPathFor(file, droppedFolderName);
      const text = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
      return { path, text };
    }));

    const notText = reads.filter((read) => read.text === null);
    const merged = mergeUploadedFiles(
      artifacts,
      reads.flatMap((read) => (read.text === null ? [] : [{ path: read.path, contents: read.text }])),
    );
    setRejected([
      ...notText.map((read) => ({ path: read.path, reason: 'not a text file' })),
      ...merged.rejected,
    ]);
    if (merged.artifacts.length > artifacts.length) setSelection({ kind: 'carried', index: artifacts.length });
    onChange(merged.artifacts);
  };

  const repoFileList = React.useMemo(() => repoBackedFiles(steps), [steps]);

  /** The server reads the saved version, so a draft that has moved the repo or
   *  the commit must not be served from a cache keyed on the step alone — and
   *  what is displayed comes from the response, never from the draft. */
  const cacheKey = (file: RepoBackedFile): string => `${file.stepId}@${file.repo}@${file.commit}`;

  const openRepoFile = async (file: RepoBackedFile): Promise<void> => {
    const { stepId, path } = file;
    setSelection({ kind: 'repo', stepId, path });
    const key = cacheKey(file);
    if (repoFiles[key] !== undefined) return;
    if (workflowName === undefined) {
      setRepoFiles((previous) => ({
        ...previous,
        [key]: { status: 'error', error: 'Save this workflow once before reading files from its repository.' },
      }));
      return;
    }
    setRepoFiles((previous) => ({ ...previous, [key]: { status: 'loading' } }));
    try {
      const result = await mediforceSilent.workflows.repoFiles({
        name: workflowName,
        stepId,
        ...(namespace === undefined ? {} : { namespace }),
      });
      setRepoFiles((previous) => ({
        ...previous,
        [key]: { status: 'loaded', repo: result.repo, commit: result.commit, files: result.files },
      }));
    } catch (cause) {
      setRepoFiles((previous) => ({
        ...previous,
        [key]: {
          status: 'error',
          error: cause instanceof Error ? cause.message : 'Could not read the repository.',
        },
      }));
    }
  };

  const openRepoStep = selection.kind === 'repo'
    ? repoFileList.find((file) => file.stepId === selection.stepId && file.path === selection.path)
    : undefined;
  const openRepoEntry = openRepoStep === undefined ? undefined : repoFiles[cacheKey(openRepoStep)];
  const openRepoFileContents = selection.kind === 'repo'
    ? openRepoEntry?.files?.find((file) => file.path === selection.path)
    : undefined;

  const issue = firstIssue(artifacts);
  const used = totalBytes(artifacts);
  const current = selection.kind === 'carried' ? artifacts[selection.index] : undefined;

  const addFile = (): void => {
    const path = newPath.trim();
    if (path === '') return;
    onChange([...artifacts, { path, contents: '' }]);
    setSelection({ kind: 'carried', index: artifacts.length });
    setNewPath('');
    setAdding(false);
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDropping(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) void upload(files);
      }}
      className={cn(
        'flex min-h-0 flex-1 gap-4 rounded-lg',
        dropping && 'outline-dashed outline-2 outline-offset-4 outline-primary/60',
      )}
    >
      <div className="flex w-56 shrink-0 flex-col gap-1">
        {artifacts.length === 0 && repoFileList.length === 0 && (
          <p className="mb-1 text-xs text-muted-foreground">
            No files yet. Add, upload or drop them here: scripts, Dockerfiles, or
            skills your workflow steps may need. A run reads them from{' '}
            <code className="font-mono">/artifacts</code>.
          </p>
        )}
        {artifacts.length === 0 && repoFileList.length > 0 && (
          <p className="mb-1 text-xs text-muted-foreground">
            This workflow carries no files of its own yet. The ones below are read
            from a repository.
          </p>
        )}
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {artifacts.map((artifact, index) => (
            <li key={index}>
              <div
                className={cn(
                  'group flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                  selection.kind === 'carried' && selection.index === index
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60',
                )}
              >
                <button
                  type="button"
                  onClick={() => setSelection({ kind: 'carried', index })}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <FileCode className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono">{artifact.path}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${artifact.path}`}
                  onClick={() => {
                    onChange(artifacts.filter((_, i) => i !== index));
                    setSelection((previous) =>
                      previous.kind === 'carried' && previous.index >= index
                        ? { kind: 'carried', index: Math.max(0, previous.index - 1) }
                        : previous,
                    );
                  }}
                  className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}

          {repoFileList.length > 0 && (
            <li className="flex items-center gap-1.5 px-2 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
              <span className="h-px flex-1 bg-border" />
              from a repository
              <span className="h-px flex-1 bg-border" />
            </li>
          )}
          {repoFileList.map((file) => {
            const isOpen = selection.kind === 'repo'
              && selection.stepId === file.stepId
              && selection.path === file.path;
            const carried = isAlreadyCarried(artifacts, file.path);
            return (
              <li key={`${file.repo}@${file.commit}:${file.path}`}>
                <button
                  type="button"
                  onClick={() => void openRepoFile(file)}
                  title={[
                    `${file.path} — from ${file.repo}`,
                    `Used by ${file.stepNames.join(', ')}`,
                    ...(carried ? ['This workflow carries its own copy, which is what runs'] : []),
                  ].join('\n')}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs',
                    isOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                  )}
                >
                  {repoFiles[cacheKey(file)]?.status === 'loading'
                    ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                    : <GitBranch className="h-3.5 w-3.5 shrink-0" />}
                  <span className="truncate font-mono">{file.path}</span>
                  {carried && (
                    <span className="shrink-0 text-[10px] text-muted-foreground/70">overridden</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        {adding ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={newPath}
              placeholder="scripts/poll.py"
              aria-label="New file path"
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addFile();
                if (e.key === 'Escape') {
                  setNewPath('');
                  setAdding(false);
                }
              }}
              className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <button
              type="button"
              onClick={addFile}
              disabled={newPath.trim() === ''}
              className="shrink-0 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
            >
              Add
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:bg-muted"
            >
              <Plus className="h-3.5 w-3.5" />
              Add file
            </button>
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
          </div>
        )}

        <input
          ref={filePickerRef}
          type="file"
          multiple
          aria-label="Files to upload"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = '';
            if (files.length > 0) void upload(files);
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
            // The picker prefixes the chosen folder's own name; drop it so the
            // files land where the author picked them from.
            const first = files[0] as (File & { webkitRelativePath?: string }) | undefined;
            const folder = first?.webkitRelativePath?.split('/')[0];
            if (files.length > 0) void upload(files, folder);
          }}
        />

        <p className="mt-1 text-[11px] text-muted-foreground">
          {formatBytes(used)} of {formatBytes(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES)} used
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {selection.kind === 'repo' ? (
          <>
            <div className="flex items-center gap-2">
              <input
                value={selection.path}
                readOnly
                aria-label="File path"
                className="w-full cursor-default rounded-md border bg-muted/40 px-2 py-1 font-mono text-xs text-muted-foreground outline-none"
              />
              <button
                type="button"
                disabled={openRepoFileContents === undefined || openRepoFileContents.truncated === true}
                title={openRepoFileContents?.truncated === true
                  ? 'This file is larger than a workflow may carry, so it cannot be copied in'
                  : undefined}
                onClick={() => setConfirmingTakeover(true)}
                className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
              >
                Edit in workflow
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {openRepoEntry?.status === 'error' ? (
                <p className="text-xs text-destructive">{openRepoEntry.error}</p>
              ) : openRepoEntry === undefined || openRepoEntry.status === 'loading' ? (
                <p className="text-xs text-muted-foreground">
                  Reading {openRepoStep?.repo ?? 'the repository'} at the pinned commit…
                </p>
              ) : openRepoFileContents === undefined ? (
                <p className="text-xs text-muted-foreground">
                  Nothing was found at {selection.path} in {openRepoEntry.repo ?? openRepoStep?.repo ?? 'the repository'}.
                </p>
              ) : (
                <CodeEditor
                  key={`${selection.stepId}:${selection.path}`}
                  value={openRepoFileContents.contents}
                  language="text"
                  readOnly
                  onChange={() => undefined}
                />
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              {openRepoEntry?.repo === undefined ? 'Read-only.' : (
                <>
                  Read-only, from <span className="font-mono">{openRepoEntry.repo}</span>
                  @{openRepoEntry.commit?.slice(0, 12)}, as last saved.
                </>
              )}
              {openRepoFileContents?.truncated === true
                && ' Too large to carry, so only the start is shown.'}
            </p>
          </>
        ) : current === undefined ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            Select a file to edit it
          </div>
        ) : (
          <>
            <input
              value={current.path}
              aria-label="File path"
              onChange={(e) =>
                onChange(artifacts.map((artifact, i) =>
                  (selection.kind === 'carried' && i === selection.index ? { ...artifact, path: e.target.value } : artifact)))
              }
              className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              <CodeEditor
                value={current.contents}
                language="text"
                onChange={(contents) =>
                  onChange(artifacts.map((artifact, i) =>
                    (selection.kind === 'carried' && i === selection.index ? { ...artifact, contents } : artifact)))
                }
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Inside a run this file is <code className="font-mono">/artifacts/{current.path}</code>.
            </p>
          </>
        )}
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
      </div>

      <Dialog.Root open={confirmingTakeover} onOpenChange={setConfirmingTakeover}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-background p-4 shadow-lg">
            <Dialog.Title className="text-sm font-medium">Edit this file in the workflow?</Dialog.Title>
            <Dialog.Description className="mt-1.5 text-xs text-muted-foreground">
              The workflow copies it in and builds from that copy instead of{' '}
              <span className="font-mono">{openRepoEntry?.repo ?? openRepoStep?.repo}</span>. Later commits there stop
              reaching this workflow. Deleting the file here hands the repository back.
            </Dialog.Description>
            <div className="mt-3 flex justify-end gap-2">
              <Dialog.Close className="rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">
                Cancel
              </Dialog.Close>
              <button
                type="button"
                onClick={() => {
                  if (openRepoFileContents === undefined) return;
                  const next = takeOverFiles(artifacts, [
                    { path: openRepoFileContents.path, contents: openRepoFileContents.contents },
                  ]);
                  onChange(next);
                  setSelection({
                    kind: 'carried',
                    index: next.findIndex((file) => file.path === openRepoFileContents.path),
                  });
                  setConfirmingTakeover(false);
                }}
                className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:opacity-90"
              >
                Edit in workflow
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
