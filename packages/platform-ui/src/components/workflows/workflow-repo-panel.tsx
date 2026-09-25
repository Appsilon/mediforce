'use client';

import * as React from 'react';
import { ChevronRight, FileText, Folder, GitBranch, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforceSilent } from '@/lib/mediforce';
import { formatBytes } from '@/lib/format';
import {
  buildRepoTree,
  referencedPaths,
  repoSources,
  type RepoSource,
  type RepoTreeNode,
} from '@/lib/repo-sources';
import { CodeEditor } from './workflow-editor/code-editor';
import type { WorkflowStep } from '@mediforce/platform-core';

type OpenedFile =
  | { kind: 'loading'; path: string }
  | { kind: 'text'; path: string; contents: string; truncated?: boolean }
  | { kind: 'too-large'; path: string; maxBytes: number }
  | { kind: 'error'; path: string; message: string };

interface TreeState {
  entries: { path: string }[] | null;
  error: string | null;
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
  /** Paths the workflow names; these are the files a reader came for. */
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
          title="Named by a step in this workflow"
          className="ml-auto shrink-0 rounded-full bg-primary-subtle px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          used
        </span>
      )}
    </button>
  );
}

function RepoExplorer({
  source,
  steps,
  workflowName,
  savedSources,
  namespace,
}: {
  source: RepoSource;
  steps: WorkflowStep[];
  /** Absent for a draft: the read then goes by repo and commit instead. */
  workflowName?: string;
  /** `repo@commit` pairs the *saved* definition holds. */
  savedSources: Set<string>;
  namespace?: string;
}) {
  // The saved read names a step, and the server resolves that step's repo out
  // of the stored definition. If the canvas has since been pointed somewhere
  // else, the header would say one commit while the server read another, so
  // an unsaved edit takes the draft path even on a saved workflow.
  const saved = workflowName !== undefined
    && workflowName !== ''
    && savedSources.has(`${source.repo}@${source.commit}`);
  const [tree, setTree] = React.useState<TreeState>({ entries: null, error: null });
  const [opened, setOpened] = React.useState<OpenedFile | null>(null);
  // A draft fetch is never automatic: it clones on the platform's own key, and
  // the reader is mid-edit, so it happens when they ask for it.
  const [fetchRequested, setFetchRequested] = React.useState(false);

  const request = React.useCallback(
    (path?: string) => (saved
      ? mediforceSilent.workflows.repoFiles({
        name: workflowName,
        stepId: source.stepId,
        ...(namespace === undefined || namespace === '' ? {} : { namespace }),
        ...(path === undefined ? {} : { path }),
      })
      : mediforceSilent.workflows.draftRepoFiles({
        namespace: namespace ?? '',
        repo: source.repo,
        commit: source.commit,
        ...(path === undefined ? {} : { path }),
      })),
    [saved, workflowName, source.stepId, source.repo, source.commit, namespace],
  );

  React.useEffect(() => {
    if (!saved && !fetchRequested) return;
    let cancelled = false;
    setTree({ entries: null, error: null });
    void (async () => {
      try {
        const data = await request();
        if (!cancelled) setTree({ entries: [...data.entries], error: null });
      } catch (error) {
        if (!cancelled) {
          setTree({ entries: null, error: error instanceof Error ? error.message : String(error) });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [request, saved, fetchRequested]);

  const onOpen = async (path: string): Promise<void> => {
    setOpened({ kind: 'loading', path });
    try {
      const { file } = await request(path);
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
  const referenced = React.useMemo(() => referencedPaths(steps, source), [steps, source]);

  if (!saved && !fetchRequested) {
    return (
      <div className="m-auto max-w-sm space-y-3 text-center">
        <p className="text-sm font-medium">
          {source.repo}
          <code className="ml-2 rounded bg-muted px-1 py-0.5 font-mono text-[11px] font-normal">
            {source.commit.slice(0, 8)}
          </code>
        </p>

        {/* A declared `repoAuth` is the author saying this repository needs a
            credential, and a draft has no workflow secrets to resolve it from.
            Offering a fetch that is expected to fail is worse than not
            offering one. */}
        {source.authKey === undefined ? (
          <>
            <p className="text-xs text-muted-foreground">
              These files load on their own once the workflow is saved. You can fetch them
              now to read the repository while you are still wiring it up.
            </p>
            <button
              type="button"
              onClick={() => setFetchRequested(true)}
              data-testid="repo-fetch-now"
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Fetch now
            </button>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">
            This repository is cloned with the workflow secret{' '}
            <code className="font-mono">{source.authKey}</code>, which exists only once the
            workflow is saved. Save it, and these files can be read here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex shrink-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
        <span className="font-medium">{source.repo}</span>
        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">
          {source.commit.slice(0, 8)}
        </code>
        <span className="text-muted-foreground">
          used by {source.stepNames.join(', ')}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="min-h-0 w-1/3 overflow-y-auto rounded-md border p-1">
          {tree.error !== null && (
            <p className="p-2 text-xs text-destructive">{tree.error}</p>
          )}
          {tree.error === null && tree.entries === null && (saved || fetchRequested) && (
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
              is copied into the workflow.
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
                It is over {formatBytes(opened.maxBytes)}. Read it in {source.repo} at{' '}
                {source.commit.slice(0, 8)}.
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
    </div>
  );
}

/**
 * A read-only view of the repositories a workflow builds from. It exists
 * because a workflow whose scripts and fixtures live in git is unreadable from
 * here otherwise: you had to open GitHub to know what the workflow does.
 *
 * Read-only in the strict sense: nothing is copied into the workflow. A file
 * that is git-backed stays git-backed, so the definition never ends up
 * disagreeing with the repository it names.
 */
export function WorkflowRepoPanel({
  steps,
  savedSteps,
  workflowName,
  namespace,
}: {
  steps: WorkflowStep[];
  /** The steps as last saved, so an unsaved edit is not read as saved. */
  savedSteps?: WorkflowStep[];
  /** Absent until the workflow has been saved once; the read is by name. */
  workflowName?: string;
  namespace?: string;
}) {
  const sources = React.useMemo(() => repoSources(steps), [steps]);
  const savedSources = React.useMemo(
    () => new Set(repoSources(savedSteps ?? []).map((entry) => `${entry.repo}@${entry.commit}`)),
    [savedSteps],
  );
  const [active, setActive] = React.useState(0);

  if (sources.length === 0) {
    return (
      <p className="m-auto max-w-md text-center text-xs text-muted-foreground">
        No step here builds from a repository. Steps that do are pinned to a commit, and
        their files can be read without leaving Mediforce.
      </p>
    );
  }

  const source = sources[Math.min(active, sources.length - 1)]!;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {sources.length > 1 && (
        <div className="flex shrink-0 flex-wrap gap-1">
          {sources.map((candidate, index) => (
            <button
              key={`${candidate.repo}@${candidate.commit}`}
              type="button"
              onClick={() => setActive(index)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors',
                index === active ? 'border-primary text-primary' : 'text-muted-foreground hover:bg-muted',
              )}
            >
              <GitBranch className="h-3 w-3" />
              {candidate.repo}
              <span className="font-mono text-[10px]">{candidate.commit.slice(0, 8)}</span>
            </button>
          ))}
        </div>
      )}
      <RepoExplorer
        key={`${source.repo}@${source.commit}`}
        source={source}
        steps={steps}
        savedSources={savedSources}
        {...(workflowName === undefined ? {} : { workflowName })}
        {...(namespace === undefined ? {} : { namespace })}
      />
    </div>
  );
}
