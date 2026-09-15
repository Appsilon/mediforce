import { describe, it, expect } from 'vitest';
import type { ImageCatalogEntry } from '@mediforce/platform-core';
import { discoverEntries } from '../_discovered';
import { deriveImageCatalogEntryId } from '../_source';
import { builtImage, TEALFLOW_REPO_URL } from './fixtures';

/** A stored entry for the source `builtImage()` was built from. */
const TEALFLOW_ENTRY: ImageCatalogEntry = {
  id: deriveImageCatalogEntryId({
    kind: 'built',
    repo: TEALFLOW_REPO_URL,
    dockerfile: 'container/Dockerfile',
  }),
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: TEALFLOW_REPO_URL, dockerfile: 'container/Dockerfile' },
  capabilities: {},
};

describe('discoverEntries', () => {
  it('offers the source of an image the platform built here and nobody catalogued', () => {
    const discovered = discoverEntries(
      'alpha',
      [builtImage({ buildNamespace: 'alpha' })],
      [],
    );

    expect(discovered).toHaveLength(1);
    expect(discovered[0].source).toEqual({
      kind: 'built',
      repo: TEALFLOW_REPO_URL,
      dockerfile: 'container/Dockerfile',
    });
    expect(discovered[0].name).toBe('tealflow');
    expect(discovered[0].intent).toBe('');
  });

  it('gives a discovered entry the id it will keep once described', () => {
    const [discovered] = discoverEntries(
      'alpha',
      [builtImage({ buildNamespace: 'alpha' })],
      [],
    );

    expect(discovered.id).toBe(TEALFLOW_ENTRY.id);
  });

  it('says nothing about a source already catalogued', () => {
    const discovered = discoverEntries(
      'alpha',
      [builtImage({ buildNamespace: 'alpha' })],
      [TEALFLOW_ENTRY],
    );

    expect(discovered).toEqual([]);
  });

  it('collapses every build of one source into one entry', () => {
    const discovered = discoverEntries(
      'alpha',
      [
        builtImage({ buildNamespace: 'alpha', tag: 'bbbbbbbbbbbb', id: 'sha-2' }),
        builtImage({ buildNamespace: 'alpha', tag: 'aaaaaaaaaaaa', id: 'sha-1' }),
      ],
      [],
    );

    expect(discovered).toHaveLength(1);
  });

  it('separates two Dockerfiles in one repo, which are two images', () => {
    const discovered = discoverEntries(
      'alpha',
      [
        builtImage({ buildNamespace: 'alpha' }),
        builtImage({ buildNamespace: 'alpha', id: 'sha-2', buildDockerfile: 'container/Dockerfile.gpu' }),
      ],
      [],
    );

    expect(discovered).toHaveLength(2);
  });

  it('matches a source catalogued in shorthand against the URL the labels carry', () => {
    const shorthandEntry: ImageCatalogEntry = {
      ...TEALFLOW_ENTRY,
      source: { kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'container/Dockerfile' },
    };

    expect(discoverEntries('alpha', [builtImage({ buildNamespace: 'alpha' })], [shorthandEntry]))
      .toEqual([]);
  });

  it('ignores an image built for another namespace', () => {
    expect(discoverEntries('alpha', [builtImage({ buildNamespace: 'beta' })], [])).toEqual([]);
  });

  it('ignores an image the platform did not build', () => {
    const pulled = builtImage({
      repository: 'postgres',
      tag: '17',
      buildRepo: undefined,
      buildDockerfile: undefined,
      buildNamespace: undefined,
    });

    expect(discoverEntries('alpha', [pulled], [])).toEqual([]);
  });

  it('ignores a build from a local path, which nothing else can rebuild', () => {
    const residue = builtImage({
      buildNamespace: 'alpha',
      buildRepo: '/tmp/scratch/provenance-demo/repo.git',
    });

    expect(discoverEntries('alpha', [residue], [])).toEqual([]);
  });
});
