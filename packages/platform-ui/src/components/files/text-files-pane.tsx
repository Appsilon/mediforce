'use client';

import * as React from 'react';
import { FileCode, Folder, Plus, Trash2 } from 'lucide-react';
import { WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES, fileTreeBytes } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format';
import { CodeEditor } from '@/components/workflows/workflow-editor/code-editor';

export interface TextFile {
  path: string;
  contents: string;
}

type TreeRow =
  | { kind: 'folder'; path: string; name: string; depth: number }
  | { kind: 'file'; index: number; name: string; depth: number };

/** The files as a tree: pinned paths first, then by path, each folder once
 *  above its files. Rows keep the file's index in `files`, which is what edits
 *  address, so a rename does not lose the selection. */
function treeRows(files: ReadonlyArray<TextFile>, pinnedPaths: ReadonlyArray<string>): TreeRow[] {
  const rank = (path: string): number => {
    const at = pinnedPaths.indexOf(path);
    return at === -1 ? pinnedPaths.length : at;
  };
  const order = files
    .map((file, index) => ({ file, index }))
    .sort((left, right) => {
      const byRank = rank(left.file.path) - rank(right.file.path);
      if (byRank !== 0) return byRank;
      return left.file.path < right.file.path ? -1 : left.file.path > right.file.path ? 1 : 0;
    });
  const rows: TreeRow[] = [];
  const shown = new Set<string>();
  for (const { file, index } of order) {
    const segments = file.path.split('/');
    for (let depth = 1; depth < segments.length; depth += 1) {
      const folder = segments.slice(0, depth).join('/');
      if (shown.has(folder)) continue;
      shown.add(folder);
      rows.push({ kind: 'folder', path: folder, name: segments[depth - 1] ?? '', depth: depth - 1 });
    }
    rows.push({ kind: 'file', index, name: segments[segments.length - 1] ?? file.path, depth: segments.length - 1 });
  }
  return rows;
}

/**
 * An editable set of text files: a folder tree beside a code editor, with
 * add, remove, rename and a size meter. Where the files come from and what an
 * upload does to them is the caller's: it passes its upload buttons as
 * `actions` and takes a drop through `onDrop`.
 */
export function TextFilesPane({
  files,
  onChange,
  readOnly,
  issuesByIndex,
  pinnedPaths,
  emptyHint,
  selected,
  onSelect,
  onDrop,
  actions,
  hint,
  footer,
  fileNote,
  pathPlaceholder,
  listLabel,
  className,
}: {
  files: ReadonlyArray<TextFile>;
  onChange: (next: TextFile[]) => void;
  readOnly: boolean;
  /** The first problem with each file, by its index in `files`. */
  issuesByIndex?: ReadonlyMap<number, string>;
  /** Paths listed first that can be neither removed nor renamed. */
  pinnedPaths?: ReadonlyArray<string>;
  /** Shown above the tree while there are no files. */
  emptyHint?: React.ReactNode;
  selected: number;
  onSelect: (index: number) => void;
  /** Takes what was dropped on the pane; read `items` before the first await. */
  onDrop?: (items: DataTransferItemList) => void;
  /** Upload buttons and their hidden inputs, beside "Add file". */
  actions?: React.ReactNode;
  /** Text under the size meter. */
  hint?: React.ReactNode;
  /** Below the editor: rejected uploads, set-wide problems. */
  footer?: React.ReactNode;
  /** A line under the editor about the selected file. */
  fileNote?: (file: TextFile) => React.ReactNode;
  pathPlaceholder: string;
  listLabel: string;
  className?: string;
}) {
  const pinned = pinnedPaths ?? [];
  const [newPath, setNewPath] = React.useState<string | null>(null);
  const [dropping, setDropping] = React.useState(false);
  const droppable = readOnly === false && onDrop !== undefined;
  const current = files[selected];
  const currentIssue = issuesByIndex?.get(selected);

  const patchSelected = (patch: Partial<TextFile>): void => {
    onChange(files.map((file, at) => (at === selected ? { ...file, ...patch } : file)));
  };

  const addFile = (): void => {
    const path = (newPath ?? '').trim();
    if (path === '') return;
    onChange([...files, { path, contents: '' }]);
    onSelect(files.length);
    setNewPath(null);
  };

  const removeFile = (index: number): void => {
    onChange(files.filter((_, at) => at !== index));
    onSelect(selected >= index ? Math.max(0, selected - 1) : selected);
  };

  return (
    <div
      onDragOver={(event) => {
        if (droppable === false) return;
        event.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(event) => {
        if (droppable === false) return;
        event.preventDefault();
        setDropping(false);
        onDrop(event.dataTransfer.items);
      }}
      className={cn(
        'flex min-h-0 flex-1 gap-4 rounded-lg',
        className,
        dropping && 'outline-dashed outline-2 outline-offset-4 outline-primary/60',
      )}
    >
      <div className="flex w-60 shrink-0 flex-col gap-1">
        {files.length === 0 && emptyHint !== undefined && (
          <p className="mb-1 text-xs text-muted-foreground">{emptyHint}</p>
        )}
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label={listLabel}>
          {treeRows(files, pinned).map((row) => {
            if (row.kind === 'folder') {
              return (
                <li
                  key={`folder:${row.path}`}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground"
                  style={{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }}
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate font-mono">{row.name}/</span>
                </li>
              );
            }
            const path = files[row.index]?.path ?? '';
            const hasIssue = issuesByIndex?.has(row.index) === true;
            return (
              <li key={`file:${String(row.index)}`}>
                <div
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-2 py-1 text-xs',
                    row.index === selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/60',
                  )}
                  style={{ paddingLeft: `${0.5 + row.depth * 0.75}rem` }}
                >
                  <button type="button" onClick={() => onSelect(row.index)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                    <FileCode className={cn('h-3.5 w-3.5 shrink-0', hasIssue && 'text-destructive')} />
                    <span className={cn('truncate font-mono', hasIssue && 'text-destructive')}>{row.name}</span>
                  </button>
                  {readOnly === false && pinned.includes(path) === false && (
                    <button
                      type="button"
                      aria-label={`Remove ${path}`}
                      onClick={() => removeFile(row.index)}
                      className="shrink-0 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {readOnly === false && (
          <>
            {newPath !== null ? (
              <div className="flex items-center gap-1">
                <input
                  autoFocus
                  value={newPath}
                  placeholder={pathPlaceholder}
                  aria-label="New file path"
                  onChange={(event) => setNewPath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') addFile();
                    if (event.key === 'Escape') setNewPath(null);
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
                  onClick={() => setNewPath('')}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add file
                </button>
                {actions}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              {formatBytes(fileTreeBytes([...files]))} of {formatBytes(WORKFLOW_ARTIFACTS_MAX_TOTAL_BYTES)} used.
              {hint !== undefined && <> {hint}</>}
            </p>
          </>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        {current === undefined ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">
            Select a file to edit it
          </div>
        ) : readOnly ? (
          <>
            <p className="font-mono text-xs text-muted-foreground">{current.path}</p>
            <pre className="min-h-0 flex-1 overflow-auto rounded-lg border bg-muted/30 p-3 font-mono text-[11px] whitespace-pre-wrap">
              {current.contents}
            </pre>
          </>
        ) : (
          <>
            <input
              value={current.path}
              aria-label="File path"
              disabled={pinned.includes(current.path)}
              onChange={(event) => patchSelected({ path: event.target.value })}
              className="w-full rounded-md border bg-background px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring disabled:opacity-70"
            />
            {currentIssue !== undefined && <p role="alert" className="text-xs text-destructive">{currentIssue}</p>}
            <div className="min-h-0 flex-1 overflow-y-auto" data-testid="text-file-editor">
              <CodeEditor value={current.contents} language="text" onChange={(contents) => patchSelected({ contents })} />
            </div>
            {fileNote?.(current)}
          </>
        )}
        {footer}
      </div>
    </div>
  );
}
