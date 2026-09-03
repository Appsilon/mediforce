import { describe, expect, it } from 'vitest';
import type {
  ImageCatalogEntryView,
  ImageCatalogVersion,
} from '@mediforce/platform-api/contract';
import { groupByBase, matchesImageQuery, resolveVersionSource } from '../image-catalog-view';

function version(overrides: Partial<ImageCatalogVersion> = {}): ImageCatalogVersion {
  return {
    imageTag: 'mediforce-built:abc123def456',
    imageId: 'sha256:aaaa',
    created: '2 days ago',
    size: '1.2GB',
    capabilities: { status: 'known', agentCapable: true, runtimes: ['bash', 'claude'] },
    lineage: { base: null, ownLabels: {} },
    ...overrides,
  };
}

function entry(overrides: Partial<ImageCatalogEntryView> = {}): ImageCatalogEntryView {
  return {
    id: 'tealflow-1234abcd',
    name: 'TealFlow agent',
    intent: 'R-based interactive exploration of ADaM datasets',
    source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
    capabilities: {},
    versions: [version()],
    availability: 'present',
    baseEntryId: null,
    ...overrides,
  };
}

describe('resolveVersionSource', () => {
  it('[DATA] rung 1: our own build permalinks the Dockerfile at the pinned commit', () => {
    const source = resolveVersionSource(entry(), version({ commit: 'c0ffee' }));

    expect(source.rung).toBe('built');
    expect(source.url).toBe(
      'https://github.com/Appsilon/tealflow/blob/c0ffee/container/Dockerfile',
    );
  });

  it('[DATA] rung 1 with no Dockerfile pinned links the repo tree, not a guessed path', () => {
    const built = entry({ source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: '' } });

    expect(resolveVersionSource(built, version({ commit: 'c0ffee' })).url).toBe(
      'https://github.com/Appsilon/tealflow/tree/c0ffee',
    );
  });

  it('[DATA] rung 1 renders no link for a local-path repo rather than a broken one', () => {
    const local = entry({
      source: { kind: 'built', repo: '/srv/git/tealflow.git', dockerfile: 'Dockerfile' },
    });
    const source = resolveVersionSource(local, version({ commit: 'c0ffee' }));

    expect(source.rung).toBe('built');
    expect(source.url).toBeNull();
    expect(source.detail).toMatch(/local path/i);
  });

  it('[DATA] rung 2: an OCI label the image sets itself is a source', () => {
    const referenced = entry({ source: { kind: 'referenced', reference: 'my-agent' } });
    const labelled = version({
      lineage: {
        base: null,
        ownLabels: {
          'org.opencontainers.image.source': 'https://github.com/Appsilon/my-agent',
          'org.opencontainers.image.revision': 'deadbee',
        },
      },
    });

    const source = resolveVersionSource(referenced, labelled);

    expect(source.rung).toBe('labelled');
    expect(source.url).toBe('https://github.com/Appsilon/my-agent/tree/deadbee');
  });

  it('[DATA] an OCI label inherited from the base is never this image own source', () => {
    // `ownLabels` is the base's labels already subtracted (#1296), so rocker's
    // `image.source` on a local image of ours never reaches this function.
    const referenced = entry({ source: { kind: 'referenced', reference: 'my-agent' } });
    const inherited = version({
      lineage: {
        base: { entryId: 'golden-1', imageId: 'sha256:bbbb', imageTag: 'golden:latest' },
        ownLabels: { 'mediforce.build.commit': 'c0ffee' },
      },
    });

    const source = resolveVersionSource(referenced, inherited);

    expect(source.rung).toBe('none');
    expect(source.url).toBeNull();
  });

  it('[DATA] rung 3: a declared source is a permalink, marked declared not derived', () => {
    const declared = entry({
      source: { kind: 'referenced', reference: 'my-agent' },
      declaredSource: { repo: 'Appsilon/my-agent', commit: 'beefbee', dockerfile: 'Dockerfile' },
    });

    const source = resolveVersionSource(declared, version());

    expect(source.rung).toBe('declared');
    expect(source.url).toBe('https://github.com/Appsilon/my-agent/blob/beefbee/Dockerfile');
    expect(source.detail).toMatch(/declared, not derived/i);
  });

  it('[DATA] a declared source with no commit cannot be pinned, so it renders no link', () => {
    const declared = entry({
      source: { kind: 'referenced', reference: 'my-agent' },
      declaredSource: { repo: 'Appsilon/my-agent' },
    });

    const source = resolveVersionSource(declared, version());

    expect(source.rung).toBe('declared');
    expect(source.url).toBeNull();
    expect(source.detail).toMatch(/no commit is pinned/i);
  });

  it('[DATA] an own OCI label outranks a declared source, per the ladder order', () => {
    const both = entry({
      source: { kind: 'referenced', reference: 'my-agent' },
      declaredSource: { repo: 'Appsilon/declared', commit: 'beefbee' },
    });
    const labelled = version({
      lineage: {
        base: null,
        ownLabels: {
          'org.opencontainers.image.source': 'https://github.com/Appsilon/derived',
          'org.opencontainers.image.revision': 'deadbee',
        },
      },
    });

    expect(resolveVersionSource(both, labelled).url).toBe(
      'https://github.com/Appsilon/derived/tree/deadbee',
    );
  });

  it('[DATA] rung 4: nothing reachable, and it says so rather than offering a link', () => {
    const referenced = entry({ source: { kind: 'referenced', reference: 'postgres' } });

    const source = resolveVersionSource(referenced, version());

    expect(source.rung).toBe('none');
    expect(source.url).toBeNull();
    expect(source.detail).toMatch(/layer commands/i);
  });

  it('[DATA] a built entry whose version carries no commit falls through to rung 4', () => {
    expect(resolveVersionSource(entry(), version()).rung).toBe('none');
  });
});

describe('matchesImageQuery', () => {
  const tealflow = entry();

  it('[DATA] matches the intent sentence, not just the name', () => {
    expect(matchesImageQuery(tealflow, 'adam')).toBe(true);
    expect(matchesImageQuery(tealflow, 'TealFlow')).toBe(true);
  });

  it('[DATA] matches capability text, which is why the search box exists', () => {
    expect(matchesImageQuery(tealflow, 'claude')).toBe(true);
    expect(matchesImageQuery(tealflow, 'agent-capable')).toBe(true);
  });

  it('[DATA] matches the repo behind a built entry and the reference behind a pulled one', () => {
    expect(matchesImageQuery(tealflow, 'Appsilon/tealflow')).toBe(true);
    expect(
      matchesImageQuery(
        entry({ source: { kind: 'referenced', reference: 'postgres' } }),
        'postgres',
      ),
    ).toBe(true);
  });

  it('[DATA] an empty query matches everything', () => {
    expect(matchesImageQuery(tealflow, '   ')).toBe(true);
  });

  it('[DATA] a miss is a miss', () => {
    expect(matchesImageQuery(tealflow, 'python')).toBe(false);
  });
});

describe('groupByBase', () => {
  const golden = entry({ id: 'golden', name: 'Golden image', baseEntryId: null });
  const child = entry({ id: 'child', name: 'Child', baseEntryId: 'golden' });
  const grandchild = entry({ id: 'grandchild', name: 'Grandchild', baseEntryId: 'child' });
  const orphan = entry({ id: 'orphan', name: 'Orphan', baseEntryId: 'not-catalogued' });

  it('[DATA] nests each entry under the entry it was built on', () => {
    expect(groupByBase([golden, child, grandchild])).toEqual([
      { entry: golden, depth: 0, baseName: null },
      { entry: child, depth: 1, baseName: 'Golden image' },
      { entry: grandchild, depth: 2, baseName: 'Child' },
    ]);
  });

  it('[DATA] an entry whose base is not in this list is a root here, not hidden', () => {
    expect(groupByBase([orphan])).toEqual([{ entry: orphan, depth: 0, baseName: null }]);
  });

  it('[DATA] a base filtered out by search does not orphan its children off the page', () => {
    expect(groupByBase([grandchild])).toEqual([{ entry: grandchild, depth: 0, baseName: null }]);
  });
});
