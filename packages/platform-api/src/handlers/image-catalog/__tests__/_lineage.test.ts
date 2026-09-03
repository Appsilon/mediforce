import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ImageBuildStep } from '@mediforce/platform-core';
import type { DockerImageInfo } from '../../../contract/system';
import type { ImageCatalogEntryView } from '../../../contract/image-catalog';
import type { EntryViewWithoutLineage } from '../_lineage';
import type { ResolvedVersion } from '../_versions';

/** `history` holds what the daemon can answer for an image id; an id absent
 *  from it is one the daemon could not answer for — `null`, not empty.
 *  `costMs` is how long each read takes, for the budget case. */
const daemon = vi.hoisted(() => ({
  history: new Map<string, ImageBuildStep[]>(),
  calls: [] as string[],
  costMs: 0,
}));
vi.mock('../../system/_docker', () => ({
  fetchImageHistory: async (image: string) => {
    daemon.calls.push(image);
    if (daemon.costMs > 0) vi.setSystemTime(Date.now() + daemon.costMs);
    return daemon.history.get(image) ?? null;
  },
}));

const { orderByLineage, resolveCatalogLineage, withBuildSteps } = await import('../_lineage');

/**
 * The daemon has already resolved `baseImageId` by layer containment (see
 * `schemas/image-lineage.ts`); what these cases pin down is the catalog's own
 * question — which *entry* a version hangs off, and in what order the catalog
 * then reads.
 */

/** One daemon row. Its tag is its id so the row and the version that matches
 *  it name the same image, the way a real listing does. */
function image(overrides: Partial<DockerImageInfo> & { id: string }): DockerImageInfo {
  return {
    repository: 'mediforce-agent',
    tag: overrides.id,
    size: '1GB',
    created: '2 days ago',
    ...overrides,
  };
}

function version(overrides: Partial<ResolvedVersion> & { imageId: string }): ResolvedVersion {
  return {
    imageTag: `mediforce-agent:${overrides.imageId}`,
    created: '2 days ago',
    size: '1GB',
    capabilities: { status: 'unknown' },
    ...overrides,
  };
}

function entry(id: string, imageIds: string[]): EntryViewWithoutLineage {
  return {
    id,
    name: id,
    intent: `what ${id} is for`,
    source: { kind: 'referenced', reference: id },
    capabilities: {},
    availability: 'present',
    versions: imageIds.map((imageId) => version({ imageId })),
  };
}

describe('resolveCatalogLineage', () => {
  it('names the entry a version was built on, and none for a root', () => {
    const images = [
      image({ id: 'golden' }),
      image({ id: 'teal', baseImageId: 'golden' }),
    ];

    const [golden, teal] = resolveCatalogLineage(
      [entry('golden-entry', ['golden']), entry('teal-entry', ['teal'])],
      images,
    );

    expect(golden.baseEntryId).toBeNull();
    expect(golden.versions[0].lineage.base).toBeNull();
    expect(teal.baseEntryId).toBe('golden-entry');
    expect(teal.versions[0].lineage.base).toEqual({
      entryId: 'golden-entry',
      imageId: 'golden',
      imageTag: 'mediforce-agent:golden',
    });
  });

  it('groups derivatives under whatever they were built on, not under one blessed image', () => {
    // `my-python` is FROM `python3.12-slim`; nothing here knows either name.
    const images = [
      image({ id: 'slim' }),
      image({ id: 'mine', baseImageId: 'slim' }),
    ];

    const [, mine] = resolveCatalogLineage(
      [entry('slim-entry', ['slim']), entry('my-python-entry', ['mine'])],
      images,
    );

    expect(mine.baseEntryId).toBe('slim-entry');
  });

  it('resolves a chain three deep to its nearest catalogued base, not the root', () => {
    const images = [
      image({ id: 'root' }),
      image({ id: 'middle', baseImageId: 'root' }),
      image({ id: 'leaf', baseImageId: 'middle' }),
    ];

    const views = resolveCatalogLineage(
      [entry('root-entry', ['root']), entry('middle-entry', ['middle']), entry('leaf-entry', ['leaf'])],
      images,
    );

    expect(views.map((view) => view.baseEntryId)).toEqual([null, 'root-entry', 'middle-entry']);
  });

  it('walks past an uncatalogued image in the middle of the chain', () => {
    const images = [
      image({ id: 'root' }),
      image({ id: 'nobody-catalogued-me', baseImageId: 'root' }),
      image({ id: 'leaf', baseImageId: 'nobody-catalogued-me' }),
    ];

    const [, leaf] = resolveCatalogLineage(
      [entry('root-entry', ['root']), entry('leaf-entry', ['leaf'])],
      images,
    );

    expect(leaf.baseEntryId).toBe('root-entry');
  });

  it('never makes an entry its own base when one build is descended from another', () => {
    const images = [image({ id: 'newer', baseImageId: 'older' }), image({ id: 'older' })];

    const [only] = resolveCatalogLineage([entry('one-entry', ['newer', 'older'])], images);

    expect(only.baseEntryId).toBeNull();
    expect(only.versions.map((each) => each.lineage.base)).toEqual([null, null]);
  });

  it('carries the labels the image owns, so inherited provenance cannot be read as its own', () => {
    const images = [
      image({
        id: 'golden',
        ownLabels: { 'org.opencontainers.image.source': 'https://github.com/rocker-org/rocker-versioned2' },
      }),
      image({ id: 'teal', baseImageId: 'golden', ownLabels: { 'mediforce.build.commit': 'abc123' } }),
    ];

    const [, teal] = resolveCatalogLineage(
      [entry('golden-entry', ['golden']), entry('teal-entry', ['teal'])],
      images,
    );

    expect(teal.versions[0].lineage.ownLabels).toEqual({ 'mediforce.build.commit': 'abc123' });
  });

  it('names the base the way the catalog names it, not by whichever tag the daemon listed last', () => {
    // One id, two rows: `base:v1` is what somebody catalogued, `alias:latest`
    // is another tag on the same image and is listed after it.
    const images = [
      image({ id: 'base', repository: 'base', tag: 'v1' }),
      image({ id: 'base', repository: 'alias', tag: 'latest' }),
      image({ id: 'derived', baseImageId: 'base' }),
    ];
    const baseEntry: EntryViewWithoutLineage = {
      ...entry('base-entry', []),
      versions: [version({ imageId: 'base', imageTag: 'base:v1' })],
    };

    const [, derived] = resolveCatalogLineage(
      [baseEntry, entry('derived-entry', ['derived'])],
      images,
    );

    expect(derived.versions[0].lineage.base?.imageTag).toBe('base:v1');
  });

  it('leaves every entry a root when the daemon held nothing', () => {
    const views = resolveCatalogLineage(
      [
        { ...entry('golden-entry', []), availability: 'unknown' },
        { ...entry('teal-entry', []), availability: 'unknown' },
      ],
      [],
    );

    expect(views.map((view) => view.baseEntryId)).toEqual([null, null]);
  });
});

describe('orderByLineage', () => {
  const view = (id: string, baseEntryId: string | null): ImageCatalogEntryView => ({
    ...entry(id, []),
    versions: [],
    baseEntryId,
  });

  it('puts roots first, each followed by what was built on it', () => {
    const ordered = orderByLineage([
      view('teal', 'golden'),
      view('golden', null),
      view('protocol', 'golden'),
      view('standalone', null),
    ]);

    expect(ordered.map((each) => each.id)).toEqual(['golden', 'teal', 'protocol', 'standalone']);
  });

  it('nests a grandchild under its own base rather than under the root', () => {
    const ordered = orderByLineage([
      view('leaf', 'middle'),
      view('middle', 'root'),
      view('root', null),
    ]);

    expect(ordered.map((each) => each.id)).toEqual(['root', 'middle', 'leaf']);
  });

  it('treats an entry whose base is not in this listing as a root', () => {
    const ordered = orderByLineage([view('orphan', 'deleted-entry'), view('root', null)]);

    expect(ordered.map((each) => each.id)).toEqual(['orphan', 'root']);
  });

  it('lists every entry exactly once', () => {
    const entries = [view('a', null), view('b', 'a'), view('c', 'b'), view('d', null)];

    expect(orderByLineage(entries)).toHaveLength(entries.length);
  });
});

describe('withBuildSteps', () => {
  const step = (command: string): ImageBuildStep => ({ command, size: '1GB' });
  const BASE_SUMMARY = [step('RUN install R'), step('RUN install claude-code')];

  beforeEach(() => {
    daemon.history.clear();
    daemon.calls.length = 0;
    daemon.costMs = 0;
  });

  function tealView(): ImageCatalogEntryView {
    const images = [
      image({ id: 'golden' }),
      image({ id: 'teal', baseImageId: 'golden' }),
    ];
    const [, teal] = resolveCatalogLineage(
      [entry('golden-entry', ['golden']), entry('teal-entry', ['teal'])],
      images,
    );
    return teal;
  }

  it('reports only the steps added past the base boundary', async () => {
    daemon.history.set('golden', BASE_SUMMARY);
    daemon.history.set('teal', [
      ...BASE_SUMMARY,
      step('RUN install teal'),
      step('COPY mcp /app/mcp'),
    ]);

    const withSteps = await withBuildSteps(tealView());

    expect(withSteps.versions[0].lineage.addedSteps).toEqual([
      step('RUN install teal'),
      step('COPY mcp /app/mcp'),
    ]);
  });

  it('gives a root its whole summary — there is no base to cut at', async () => {
    daemon.history.set('golden', BASE_SUMMARY);
    const [golden] = resolveCatalogLineage(
      [entry('golden-entry', ['golden'])],
      [image({ id: 'golden' })],
    );

    const withSteps = await withBuildSteps(golden);

    expect(withSteps.versions[0].lineage.addedSteps).toEqual(BASE_SUMMARY);
  });

  it('reads each image once however many versions point at it', async () => {
    const images = [
      image({ id: 'golden' }),
      image({ id: 'teal-new', baseImageId: 'golden' }),
      image({ id: 'teal-old', baseImageId: 'golden' }),
    ];
    const [, teal] = resolveCatalogLineage(
      [entry('golden-entry', ['golden']), entry('teal-entry', ['teal-new', 'teal-old'])],
      images,
    );

    await withBuildSteps(teal);

    // By id, not by tag: a tag can be moved between the listing and the read.
    expect(daemon.calls).toEqual(['teal-new', 'golden', 'teal-old']);
  });

  it('omits the summary when the daemon cannot answer for the image', async () => {
    const withSteps = await withBuildSteps(tealView());

    expect(withSteps.versions[0].lineage.addedSteps).toBeUndefined();
  });

  it('omits the summary when the base history is the one that failed', async () => {
    // Without this the child's whole inherited history — the base's steps and
    // everything under them — would be published as steps the child added.
    daemon.history.set('teal', [...BASE_SUMMARY, step('RUN install teal')]);

    const withSteps = await withBuildSteps(tealView());

    expect(withSteps.versions[0].lineage.addedSteps).toBeUndefined();
  });

  it('stops reading once the entry budget is spent instead of paying a timeout per version', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const images = [
        image({ id: 'golden' }),
        ...Array.from({ length: 6 }, (_, index) =>
          image({ id: `teal-${String(index)}`, baseImageId: 'golden' }),
        ),
      ];
      const [, teal] = resolveCatalogLineage(
        [
          entry('golden-entry', ['golden']),
          entry('teal-entry', images.slice(1).map((each) => each.id)),
        ],
        images,
      );
      // A daemon answering just under its own per-call ceiling.
      daemon.costMs = 9_000;

      const withSteps = await withBuildSteps(teal);

      expect(daemon.calls.length).toBeLessThan(images.length);
      expect(withSteps.versions).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });
});
