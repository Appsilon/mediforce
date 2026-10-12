'use client';

import { useCallback, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { mediforceSilent } from '@/lib/mediforce';
import { RepoFileBrowser } from '@/components/repo/repo-file-browser';

const NO_REFERENCED_PATHS: Set<string> = new Set();

/**
 * The files an image was built from, at the commit it was built from.
 *
 * An image is what a workflow pins, so this is where its source is read — not
 * on the workflow, which names only the image and could otherwise be shown a
 * tree that is not what the image contains. The commit is the one the build
 * recorded as a label, never a branch.
 *
 * Collapsed until asked for: opening it clones the repository.
 */
export function VersionSourceFiles({
  repo,
  commit,
  dockerfile,
  namespace,
}: {
  repo: string;
  commit: string;
  /** Dockerfile path from the repo root, marked in the tree when it is known. */
  dockerfile?: string;
  namespace: string;
}) {
  const [open, setOpen] = useState(false);
  const load = useCallback(
    (path?: string) =>
      mediforceSilent.workflows.draftRepoFiles({
        namespace,
        repo,
        commit,
        ...(path === undefined ? {} : { path }),
      }),
    [namespace, repo, commit],
  );

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Source files at {commit.slice(0, 7)}
      </button>
      {open && (
        <div className="flex h-80 flex-col">
          <RepoFileBrowser
            repo={repo}
            commit={commit}
            load={load}
            referenced={dockerfile === undefined ? NO_REFERENCED_PATHS : new Set([dockerfile])}
          />
        </div>
      )}
    </div>
  );
}
