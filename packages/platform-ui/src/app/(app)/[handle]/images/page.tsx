'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Layers,
  Search,
  Server,
} from 'lucide-react';
import type {
  ImageCatalogEntryView,
  ImageCatalogVersion,
} from '@mediforce/platform-api/contract';
import { shortImageId } from '@mediforce/platform-core';
import { cn } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { ConceptPopover } from '@/components/ui/concept-intro';
import { useNamespaceRole } from '@/hooks/use-namespace-role';
import { useImageCatalogEntries, useImageCatalogEntry } from '@/hooks/use-image-catalog';
import { useWorkflowsByImage, type WorkflowImageMatch } from '@/hooks/use-workflows-by-image';
import {
  groupByBase,
  matchesImageQuery,
  resolveVersionSource,
  type ImageVersionSource,
} from './image-catalog-view';

const AVAILABILITY: Record<
  ImageCatalogEntryView['availability'],
  { label: string; className: string }
> = {
  present: {
    label: 'On the daemon',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
  },
  absent: {
    label: 'Unavailable',
    className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  },
  unknown: {
    label: 'Not checked',
    className: 'bg-muted text-muted-foreground',
  },
};

function Chip({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-full border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      {children}
    </span>
  );
}

/** Capability chips for the version an author is about to pick — the newest.
 *  An unprobed image says so rather than claiming an empty toolchain. */
function CapabilityChips({ version }: { version: ImageCatalogVersion | undefined }) {
  if (version === undefined) return null;
  if (version.capabilities.status !== 'known') {
    return <Chip title="Nobody has probed this image yet">Capabilities not probed</Chip>;
  }
  const { runtimes, agentCapable } = version.capabilities;
  return (
    <>
      {runtimes.map((runtime) => (
        <Chip key={runtime}>{runtime}</Chip>
      ))}
      {agentCapable ? (
        <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          agent-capable
        </span>
      ) : (
        <Chip title="No agent CLI found, so an agent step on this image fails at container start">
          script only
        </Chip>
      )}
      {runtimes.length === 0 && <Chip>no known runtime</Chip>}
    </>
  );
}

/** A commit is only ever shown abbreviated; the full one is in the href. */
function shortCommit(commit: string | undefined): string {
  return commit === undefined ? '' : commit.slice(0, 7);
}

/** The rung the source ladder reached, and the link if it reached one. Rungs
 *  are never presented as equivalent: the label names which one answered. */
function SourceLine({ source }: { source: ImageVersionSource }) {
  return (
    <div className="space-y-1">
      <p className="text-xs">
        <span className="font-medium text-foreground">{source.label}</span>
        <span className="text-muted-foreground"> — {source.detail}</span>
      </p>
      {source.url !== null && (
        <a
          href={source.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {source.dockerfile === undefined
            ? `Open the repository at ${shortCommit(source.commit)}`
            : `Open ${source.dockerfile} at ${shortCommit(source.commit)}`}
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}

/**
 * The layers a version adds over its base.
 *
 * Labelled layer commands everywhere it is named. `docker history` has no file
 * contents, no comments, no formatting and no `FROM` boundary — calling it a
 * Dockerfile would promise a reader something none of it delivers (#1296).
 */
function LayerCommands({
  version,
  baseTag,
}: {
  version: ImageCatalogVersion;
  baseTag: string | null;
}) {
  const steps = version.lineage.addedSteps;
  if (steps === undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        Layer commands are not available for this image right now.
      </p>
    );
  }
  if (steps.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {baseTag === null
          ? 'No layer commands recorded for this image.'
          : `Adds no layers over ${baseTag}.`}
      </p>
    );
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        {baseTag === null
          ? `${steps.length} layer command${steps.length === 1 ? '' : 's'}, oldest first.`
          : `${steps.length} layer command${steps.length === 1 ? '' : 's'} added over ${baseTag}, oldest first.`}{' '}
        These are what the image records about how it was assembled — not a Dockerfile: no file
        contents, no comments, no formatting. Build-arg values are redacted.
      </p>
      <ol className="divide-y rounded-md border bg-muted/20 text-[11px]">
        {steps.map((step, index) => (
          <li key={`${index}-${step.command}`} className="flex gap-3 px-3 py-1.5">
            <pre className="flex-1 overflow-x-auto whitespace-pre-wrap break-all font-mono">
              {step.command}
            </pre>
            <span className="shrink-0 text-muted-foreground">{step.size}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function UsedBy({
  workflows,
  loading,
  error,
}: {
  workflows: WorkflowImageMatch[] | undefined;
  loading: boolean;
  error: Error | null;
}) {
  if (error !== null) {
    return <p className="text-xs text-destructive">{error.message}</p>;
  }
  if (loading) {
    return <p className="text-xs text-muted-foreground animate-pulse">Loading usages…</p>;
  }
  if (workflows === undefined) {
    return (
      <p className="text-xs text-muted-foreground">
        No version of this image is on the daemon, so there is nothing to look for.
      </p>
    );
  }
  if (workflows.length === 0) {
    return <p className="text-xs text-muted-foreground">No workflow step pins this image.</p>;
  }
  return (
    <ul className="space-y-1">
      {workflows.map((workflow) => (
        <li key={`${workflow.namespace}:${workflow.name}`} className="text-xs">
          <Link
            href={routes.workflow(workflow.namespace, workflow.name)}
            className="font-medium text-primary hover:underline"
          >
            {workflow.title ?? workflow.name}
          </Link>
          <span className="text-muted-foreground">
            {' '}
            — {workflow.namespace}/{workflow.name} v{workflow.version} · {workflow.steps.join(', ')}
          </span>
        </li>
      ))}
    </ul>
  );
}

function VersionRow({
  entry,
  version,
  index,
  usedTags,
}: {
  entry: ImageCatalogEntryView;
  version: ImageCatalogVersion;
  index: number;
  usedTags: ReadonlySet<string> | null;
}) {
  const source = resolveVersionSource(entry, version);
  return (
    <li className="space-y-1.5 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono">{version.imageTag}</span>
        {version.commit !== undefined && (
          <span className="font-mono text-muted-foreground">{shortCommit(version.commit)}</span>
        )}
        <span className="text-muted-foreground">{version.created}</span>
        <span className="text-muted-foreground">{version.size}</span>
        <span className="font-mono text-muted-foreground">{shortImageId(version.imageId)}</span>
        {index === 0 ? <Chip>current</Chip> : <Chip>superseded</Chip>}
        {usedTags !== null && !usedTags.has(version.imageTag) && (
          <Chip title="No workflow step pins this version">unused</Chip>
        )}
      </div>
      <SourceLine source={source} />
    </li>
  );
}

function EntryCard({
  entry,
  depth,
  baseName,
  handle,
  expanded,
  onToggle,
}: {
  entry: ImageCatalogEntryView;
  depth: number;
  baseName: string | null;
  handle: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  // The listing deliberately omits the per-version layer summary, so the
  // expanded card reads the entry on its own to get it.
  const detail = useImageCatalogEntry(handle, entry.id, expanded);
  const shown = detail.entry ?? entry;
  const versions = shown.versions;
  const newest = versions[0];

  const imageTags = useMemo(() => versions.map((version) => version.imageTag), [versions]);
  const usage = useWorkflowsByImage(imageTags, expanded);
  const usedTags = useMemo(
    () =>
      usage.workflows === undefined
        ? null
        : new Set(usage.workflows.flatMap((workflow) => workflow.images)),
    [usage.workflows],
  );

  const availability = AVAILABILITY[shown.availability];

  return (
    <div style={{ marginLeft: depth * 24 }} data-testid={`image-entry-${entry.id}`}>
      <div className="rounded-lg border bg-card shadow-sm">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex w-full items-start gap-3 px-4 py-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{shown.name}</h3>
              <span
                className={cn(
                  'rounded-full px-2 py-0.5 text-[10px] font-medium',
                  availability.className,
                )}
              >
                {availability.label}
              </span>
              {baseName !== null && (
                <span className="text-xs text-muted-foreground">Built on {baseName}</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{shown.intent}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <CapabilityChips version={newest} />
            </div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">
            {versions.length} version{versions.length === 1 ? '' : 's'}
          </span>
        </button>

        {expanded && (
          <div className="space-y-4 border-t px-4 py-3">
            {detail.error !== null && (
              <p className="text-xs text-destructive">{detail.error.message}</p>
            )}

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {newest === undefined || newest.lineage.base === null
                  ? 'Layer commands'
                  : 'What it adds over its base'}
              </h4>
              {newest === undefined ? (
                <p className="text-xs text-muted-foreground">
                  No version of this image is on the daemon, so there is nothing to summarise.
                </p>
              ) : detail.loading ? (
                <p className="text-xs text-muted-foreground animate-pulse">
                  Reading layer commands…
                </p>
              ) : (
                <LayerCommands
                  version={newest}
                  baseTag={newest.lineage.base?.imageTag ?? null}
                />
              )}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Versions
              </h4>
              {versions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {shown.availability === 'unknown'
                    ? 'The daemon could not be reached, so its versions are unknown.'
                    : 'No image matching this entry is on the daemon.'}
                </p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {versions.map((version, index) => (
                    <VersionRow
                      key={version.imageId + version.imageTag}
                      entry={shown}
                      version={version}
                      index={index}
                      usedTags={usedTags}
                    />
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-1.5">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Used by
              </h4>
              <UsedBy
                workflows={usage.workflows}
                loading={usage.loading}
                error={usage.error}
              />
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

export default function ImagesPage() {
  const params = useParams();
  const rawHandle = params.handle;
  const handle = Array.isArray(rawHandle) ? rawHandle[0] : (rawHandle ?? '');
  const search = useSearchParams();
  const { canAdmin } = useNamespaceRole(handle);

  const { entries, loading, error } = useImageCatalogEntries(handle);
  const [query, setQuery] = useState('');
  // `?entry=` is how Infrastructure crosses over to a specific entry.
  const [expandedId, setExpandedId] = useState<string | null>(search.get('entry'));

  const grouped = useMemo(
    () => groupByBase(entries.filter((entry) => matchesImageQuery(entry, query))),
    [entries, query],
  );

  const daemonUnknown =
    entries.length > 0 && entries.every((entry) => entry.availability === 'unknown');

  return (
    <div className="flex flex-1 flex-col p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5">
            <h1 className="font-headline text-xl font-semibold">Images</h1>
            <ConceptPopover label="What is an image entry?">
              <p>
                <strong>
                  An image catalog entry is an image this workspace offers for workflow steps.
                </strong>{' '}
                It is keyed on the repository and Dockerfile it is built from, not on the commit —
                so a rebuild is another version of the entry you already picked, not another row.
              </p>
              <p>
                Everything but the one sentence of intent is derived from the image itself:
                capabilities are probed, versions and lineage are recomputed from the daemon on
                every read. Admin → Infrastructure stays the raw daemon inventory.
              </p>
            </ConceptPopover>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Images @{handle} offers for workflow steps, grouped by what each was built on.
          </p>
        </div>
        {canAdmin && (
          <Link
            href={routes.adminInfrastructure(handle)}
            className="inline-flex items-center gap-1.5 rounded-md border bg-card px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted"
          >
            <Server className="h-3.5 w-3.5" />
            Raw daemon inventory
          </Link>
        )}
      </div>

      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search images by name, intent, repository or capability…"
          aria-label="Search images"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="w-full rounded-md border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {error !== null && (
        <div className="mb-4 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error.message}
        </div>
      )}

      {daemonUnknown && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-800 dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-xs text-muted-foreground">
            The Docker daemon could not be reached, so versions, capabilities and lineage are
            unknown for now. The entries themselves still read.
          </p>
        </div>
      )}

      {loading ? (
        <div className="py-20 text-center text-sm text-muted-foreground animate-pulse">
          Loading images…
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Layers className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground">
            {query.trim() === ''
              ? 'No images catalogued yet. Register one with `mediforce images create`.'
              : 'No images match your search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ entry, depth, baseName }) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              depth={depth}
              baseName={baseName}
              handle={handle}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId((current) => (current === entry.id ? null : entry.id))}
            />
          ))}
        </div>
      )}
    </div>
  );
}
