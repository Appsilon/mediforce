import { OCI_LABELS, githubPermalink } from '@mediforce/platform-core';
import type {
  ImageCatalogEntryView,
  ImageCatalogVersion,
} from '@mediforce/platform-api/contract';

/**
 * The source ladder (#1297), resolved for one version.
 *
 * Four rungs, and they are **not** equivalent answers — the whole point of
 * naming them is that the UI must not present a guess with the same confidence
 * as a build record:
 *
 *   1. `built`    — our own build labels: the exact Dockerfile at a pinned commit.
 *   2. `labelled` — an OCI label the image sets *itself*. `lineage.ownLabels`
 *                   has the base's labels already subtracted (#1296), which is
 *                   the only reason this rung is safe at all: Docker inherits
 *                   labels indistinguishably, and a local image of ours was
 *                   observed carrying rocker's `image.source`.
 *   3. `declared` — a human wrote it on the entry. Same shape as rung 1,
 *                   labelled declared rather than derived.
 *   4. `none`     — nothing. The layer commands are what is left, and they are
 *                   layer commands, never "the Dockerfile".
 */
export type ImageSourceRung = 'built' | 'labelled' | 'declared' | 'none';

export interface ImageVersionSource {
  rung: ImageSourceRung;
  /** Short heading for the rung, e.g. "Built by Mediforce". */
  label: string;
  /** One sentence saying what this rung could reach, and why not more. */
  detail: string;
  repo?: string;
  commit?: string;
  dockerfile?: string;
  /** GitHub permalink at the pinned commit, or `null` when none is honest. */
  url: string | null;
}

/** Why a rung that named a repo still cannot offer a link. `githubPermalink`
 *  refuses a local path, a non-GitHub host and an unpinned commit; each is a
 *  different sentence to a reader looking for the file. */
function noLinkReason(repo: string, commit: string | undefined): string {
  if (commit === undefined || commit.length === 0) {
    return 'No commit is pinned, so there is no permalink to offer.';
  }
  if (repo.startsWith('/') || repo.startsWith('.')) {
    return `${repo} is a local path, not a GitHub repository that can be browsed.`;
  }
  return `${repo} is not a GitHub repository, and the file-at-commit URL shape is GitHub's.`;
}

function withLink(
  rung: ImageSourceRung,
  label: string,
  reached: string,
  repo: string,
  commit: string | undefined,
  dockerfile: string | undefined,
): ImageVersionSource {
  const url = commit === undefined ? null : githubPermalink(repo, commit, dockerfile);
  return {
    rung,
    label,
    detail: url === null ? `${reached} ${noLinkReason(repo, commit)}` : reached,
    repo,
    ...(commit === undefined ? {} : { commit }),
    ...(dockerfile === undefined || dockerfile === '' ? {} : { dockerfile }),
    url,
  };
}

/**
 * The best rung the ladder reaches for this version.
 *
 * Nothing here fetches: every input is already on the entry or the version, so
 * the link is buildable with no GitHub API, no auth and no network — a private
 * repo resolves against the viewer's own GitHub session.
 */
export function resolveVersionSource(
  entry: ImageCatalogEntryView,
  version: ImageCatalogVersion,
): ImageVersionSource {
  if (entry.source.kind === 'built' && version.commit !== undefined) {
    return withLink(
      'built',
      'Built by Mediforce',
      'The platform built this image, so its Dockerfile is pinned at the commit it was built from.',
      entry.source.repo,
      version.commit,
      entry.source.dockerfile,
    );
  }

  const labelledRepo = version.lineage.ownLabels[OCI_LABELS.source];
  const labelledCommit = version.lineage.ownLabels[OCI_LABELS.revision];
  if (labelledRepo !== undefined && labelledCommit !== undefined) {
    return withLink(
      'labelled',
      'Declared by the image',
      'This image sets its own OCI source labels — labels inherited from its base do not count — but they name no Dockerfile path, so this points at the repository at that revision.',
      labelledRepo,
      labelledCommit,
      undefined,
    );
  }

  const declared = entry.declaredSource;
  if (declared?.repo !== undefined) {
    return withLink(
      'declared',
      'Declared by a member',
      'Someone declared this source on the entry. It is declared, not derived from the image.',
      declared.repo,
      declared.commit,
      declared.dockerfile,
    );
  }

  return {
    rung: 'none',
    label: 'No source recorded',
    detail:
      'Nothing on this image names a repository and a commit, so there is no Dockerfile to reach. The layer commands are what the image records about how it was assembled.',
    url: null,
  };
}

function capabilityText(version: ImageCatalogVersion): string {
  if (version.capabilities.status !== 'known') return '';
  const runtimes = version.capabilities.runtimes.join(' ');
  return version.capabilities.agentCapable ? `${runtimes} agent-capable` : runtimes;
}

/**
 * Whether an entry matches the search box.
 *
 * Across name, intent, source and capabilities — the absence of any search at
 * all is what #1285 §4 called out, and a search that only matched the name
 * would leave "which image has R?" unanswerable, which is the question this
 * view exists to answer.
 */
export function matchesImageQuery(entry: ImageCatalogEntryView, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') return true;

  const haystack = [
    entry.name,
    entry.intent,
    entry.source.kind === 'built' ? entry.source.repo : entry.source.reference,
    entry.source.kind === 'built' ? entry.source.dockerfile : '',
    ...entry.versions.map((version) => version.imageTag),
    ...entry.versions.map(capabilityText),
  ]
    .join(' ')
    .toLowerCase();

  return haystack.includes(needle);
}

/** One row of the grouped catalog: the entry, how deep under its base it sits,
 *  and the base's name for the "built on" line. */
export interface GroupedImageEntry {
  entry: ImageCatalogEntryView;
  depth: number;
  baseName: string | null;
}

/**
 * Annotate the handler's roots-first ordering with the depth to render it at.
 *
 * The order itself is the server's — it already walks the tree — so this only
 * measures each entry's distance from its root *within the list it is given*.
 * That qualifier is what makes search safe: an entry whose base the query
 * filtered out becomes a root here rather than being indented under a card
 * that is not on the page.
 */
export function groupByBase(entries: readonly ImageCatalogEntryView[]): GroupedImageEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));

  return entries.map((entry) => {
    const base = entry.baseEntryId === null ? undefined : byId.get(entry.baseEntryId);
    let depth = 0;
    let ancestor = base;
    const seen = new Set<string>([entry.id]);
    while (ancestor !== undefined && !seen.has(ancestor.id)) {
      seen.add(ancestor.id);
      depth += 1;
      ancestor = ancestor.baseEntryId === null ? undefined : byId.get(ancestor.baseEntryId);
    }
    return { entry, depth, baseName: base?.name ?? null };
  });
}
