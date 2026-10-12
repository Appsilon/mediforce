'use client';

import * as React from 'react';
import { ChevronRight, FileText, Folder, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/format';
import { buildRepoTree, type RepoTreeNode } from '@/lib/repo-sources';
import { CodeEditor } from '@/components/workflows/workflow-editor/code-editor';

type OpenedFile =
  | { kind: 'loading'; path: string }
  | { kind: 'text'; path: string; contents: string; truncated?: boolean }
  | { kind: 'too-large'; path: string; maxBytes: number }
  | { kind: 'error'; path: string; message: string };

interface TreeState {
  entries: { path: string }[] | null;
  error: string | null;
}

/** What a read of the repository returns: the tree, or the one file asked for. */
export interface RepoRead {
  entries: readonly { path: string }[];
  file?:
    | { path: string; contents: string; truncated?: boolean }
    | { path: string; maxBytes: number; tooLarge: true };
}

function TreeRow({
  node,
  depth,
  openPath,
  referenced,
  onOpen,
}: {
  node: RepoTreeNode;
  depth: number;
  openPath: string | null;
  /** Paths the reader's workflow or build names; these are the files they came for. */
  referenced: Set<string>;
  onOpen: (path: string) => void;
}) {
  const [expanded, setExpanded] = React.useState(depth === 0);
  if (!node.isFile) {
    return (
      <>
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted"
          style={{ paddingLeft: depth * 12 + 8 }}
        >
          <ChevronRight className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')} />
          <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            openPath={openPath}
            referenced={referenced}
            onOpen={onOpen}
          />
        ))}
      </>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(node.path)}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs transition-colors hover:bg-muted',
        openPath === node.path && 'bg-primary-subtle text-primary',
      )}
      style={{ paddingLeft: depth * 12 + 8 + 18 }}
    >
      <FileText
        className={cn(
          'h-3.5 w-3.5 shrink-0',
          referenced.has(node.path) ? 'text-primary' : 'text-muted-foreground',
        )}
      />
      <span className={cn('truncate', referenced.has(node.path) && 'font-medium')}>
        {node.name}
      </span>
      {referenced.has(node.path) && (
        <span
          title="Named by the workflow or build that reads this repository"
          className="ml-auto shrink-0 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          used
        </span>
      )}
    </button>
  );
}

/**
 * A repository's tree beside the file opened from it, read-only. It reads the
 * tree on mount and a file only when somebody opens it, so mounting it is the
 * act of asking — callers decide when that happens.
 *
 * `load` must be stable: a new identity re-reads the tree.
 */
export function RepoFileBrowser({
  repo,
  commit,
  load,
  referenced,
}: {
  repo: string;
  commit: string;
  load: (path?: string) => Promise<RepoRead>;
  referenced: Set<string>;
}) {
  const [tree, setTree] = React.useState<TreeState>({ entries: null, error: null });
  const [opened, setOpened] = React.useState<OpenedFile | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setTree({ entries: null, error: null });
    void (async () => {
      try {
        const data = await load();
        if (!cancelled) setTree({ entries: [...data.entries], error: null });
      } catch (error) {
        if (!cancelled) {
          setTree({ entries: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const onOpen = async (path: string): Promise<void> => {
    setOpened({ kind: 'loading', path });
    try {
      const { file } = await load(path);
      if (file === undefined) {
        setOpened({ kind: 'error', path, message: 'The repository returned nothing for this file.' });
        return;
      }
      if ('tooLarge' in file) {
        setOpened({ kind: 'too-large', path, maxBytes: file.maxBytes });
        return;
      }
      setOpened({ kind: 'text', path, contents: file.contents, ...(file.truncated === undefined ? {} : { truncated: file.truncated }) });
    } catch (error) {
      setOpened({ kind: 'error', path, message: error instanceof Error ? error.message : String(error) });
    }
  };

  const nodes = React.useMemo(() => buildRepoTree(tree.entries ?? []), [tree.entries]);

  return (
    <div className="flex min-h-0 flex-1 gap-3">
      <div className="min-h-0 w-1/3 overflow-y-auto rounded-md border p-1">
        {tree.error !== null && (
          <p className="p-2 text-xs text-destructive">{tree.error}</p>
        )}
        {tree.error === null && tree.entries === null && (
          <p className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Reading the repository…
          </p>
        )}
        {nodes.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            openPath={opened?.path ?? null}
            referenced={referenced}
            onOpen={(path) => void onOpen(path)}
          />
        ))}
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {opened === null && (
          <p className="m-auto max-w-sm text-center text-xs text-muted-foreground">
            Pick a file to read it. Nothing is downloaded until you do, and nothing here
            is copied anywhere.
          </p>
        )}
        {opened?.kind === 'loading' && (
          <p className="m-auto flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Fetching {opened.path}…
          </p>
        )}
        {opened?.kind === 'too-large' && (
          <div className="m-auto max-w-sm rounded-md border border-amber-200 bg-amber-50 p-3 text-center text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200">
            <p className="font-medium">{opened.path} is too large to open here</p>
            <p className="mt-1">
              It is over {formatBytes(opened.maxBytes)}. Read it in {repo} at{' '}
              {commit.slice(0, 8)}.
            </p>
          </div>
        )}
        {opened?.kind === 'error' && (
          <p className="m-auto max-w-sm text-center text-xs text-destructive">{opened.message}</p>
        )}
        {opened?.kind === 'text' && (
          <>
            <div className="mb-1 flex shrink-0 items-baseline gap-2">
              <span className="truncate font-mono text-xs">{opened.path}</span>
              {opened.truncated === true && (
                <span className="text-[11px] text-amber-700 dark:text-amber-300">shown in part</span>
              )}
            </div>
            <CodeEditor
              value={opened.contents}
              onChange={() => {}}
              language="text"
              readOnly
              fill
              className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-md border"
            />
          </>
        )}
      </div>
    </div>
  );
}
