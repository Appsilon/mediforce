'use client';

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
        <p className="text-xs text-muted-foreground">
          From the repository root, or from the build context when one is set. Leave blank for
          the default. Two Dockerfiles in one repository are two entries, because they are two
          images.
        </p>
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
        <p className="text-xs text-muted-foreground">
          <strong className="text-foreground">
            Blank builds from the directory the Dockerfile is in.
          </strong>{' '}
          Everything it <code>COPY</code>s must then sit beside it. To reach files elsewhere, name
          a directory — <code>.</code> for the repository root — so{' '}
          <code>container/Dockerfile</code> with context <code>.</code> can{' '}
          <code>COPY scripts/</code>. The context is not part of the entry&apos;s key, but the
          Dockerfile path is read from it — so a change that makes the same path name a different
          file moves the entry.
        </p>
      </div>
    </>
  );
}
