'use client';

import * as React from 'react';
import Link from 'next/link';
import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';
import { mediforceSilent } from '@/lib/mediforce';
import { routes } from '@/lib/routes';
import {
  referencedPaths,
  repoSources,
  type RepoSource,
} from '@/lib/repo-sources';
import { RepoFileBrowser } from '@/components/repo/repo-file-browser';
import { stepContainerConfig, type WorkflowStep } from '@mediforce/platform-core';

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

      <RepoFileBrowser repo={source.repo} commit={source.commit} load={request} referenced={referenced} />
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
    // A step pinned to an image runs what the image holds, which may differ
    // from any branch of its repository — its files are read where the image
    // is, pinned to the commit it was built from.
    const pinsImage = steps.some((step) => stepContainerConfig(step).image !== undefined);
    return (
      <p className="m-auto max-w-md text-center text-xs text-muted-foreground">
        No step here builds from a repository. Steps that do are pinned to a commit, and
        their files can be read without leaving Mediforce.
        {pinsImage && namespace !== undefined && namespace !== '' && (
          <>
            {' '}Steps pinned to an image run what the image holds; read the files it was built
            from in{' '}
            <Link href={routes.images(namespace)} className="font-medium text-primary hover:underline">
              Images
            </Link>.
          </>
        )}
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
