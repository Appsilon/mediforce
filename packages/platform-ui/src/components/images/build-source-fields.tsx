'use client';

import { resolveDockerBuildPaths, type DockerBuildPaths } from '@mediforce/platform-core';

/**
 * The Dockerfile and build-context inputs of a built source. **Add image** and
 * **Edit** ask for the same two things, with the same rules, so one component
 * states them.
 */
export function DockerfileAndContextFields({
  idPrefix,
  dockerfile,
  onDockerfileChange,
  context,
  onContextChange,
}: {
  idPrefix: string;
  dockerfile: string;
  onDockerfileChange: (value: string) => void;
  context: string;
  onContextChange: (value: string) => void;
}) {
  return (
    <>
      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-dockerfile`} className="text-sm font-medium">
          Dockerfile <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-dockerfile`}
          value={dockerfile}
          onChange={(event) => onDockerfileChange(event.target.value)}
          placeholder="container/Dockerfile"
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">Relative to the build context</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={`${idPrefix}-context`} className="text-sm font-medium">
          Build context <span className="text-muted-foreground">(optional)</span>
        </label>
        <input
          id={`${idPrefix}-context`}
          value={context}
          onChange={(event) => onContextChange(event.target.value)}
          placeholder="."
          className="w-full rounded-md border bg-background px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <BuildPathsPreview testId={`${idPrefix}-build-paths`} dockerfile={dockerfile} context={context} />
    </>
  );
}

/** The two paths `docker build` will be handed, from the repo root — the same
 *  resolution the builders run, so a mistyped combination shows before a build. */
function BuildPathsPreview({
  testId,
  dockerfile,
  context,
}: {
  testId: string;
  dockerfile: string;
  context: string;
}) {
  let paths: DockerBuildPaths | null;
  try {
    paths = resolveDockerBuildPaths(dockerfile, context);
  } catch {
    paths = null;
  }

  return (
    <div data-testid={testId} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
      {paths === null ? (
        <p className="text-destructive">This path is outside the repository.</p>
      ) : (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">Dockerfile</dt>
          <dd className="break-all font-mono">/{paths.dockerfile}</dd>
          <dt className="text-muted-foreground">Build context</dt>
          <dd className="break-all font-mono">/{paths.context}</dd>
        </dl>
      )}
    </div>
  );
}
