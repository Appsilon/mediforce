import { describe, it, expect } from 'vitest';
import type { DockerImageInfo } from '../../../contract/system';
import { entryAvailability, resolveEntryVersions } from '../_versions';

const REPO = 'git@github.com:Appsilon/tealflow.git';

function image(overrides: Partial<DockerImageInfo> = {}): DockerImageInfo {
  return {
    repository: 'mediforce-built',
    tag: 'aaaaaaaaaaaa',
    id: 'sha-1',
    size: '1.2GB',
    created: '2 days ago',
    ...overrides,
  };
}

describe('resolveEntryVersions', () => {
  it('folds two builds of one source into two versions of one entry', () => {
    const images = [
      image({
        tag: 'newer',
        id: 'sha-new',
        buildRepo: REPO,
        buildDockerfile: 'container/Dockerfile',
        buildCommit: 'def5678',
      }),
      image({
        tag: 'older',
        id: 'sha-old',
        buildRepo: REPO,
        buildDockerfile: 'container/Dockerfile',
        buildCommit: 'abc1234',
      }),
    ];

    const versions = resolveEntryVersions(
      { kind: 'built', repo: REPO, dockerfile: 'container/Dockerfile' },
      images,
    );

    expect(versions.map((v) => v.commit)).toEqual(['def5678', 'abc1234']);
    expect(versions[0].imageTag).toBe('mediforce-built:newer');
  });

  it('does not claim an image built from a different Dockerfile in the same repo', () => {
    const images = [
      image({ buildRepo: REPO, buildDockerfile: 'container/Dockerfile.gpu' }),
    ];

    expect(
      resolveEntryVersions(
        { kind: 'built', repo: REPO, dockerfile: 'container/Dockerfile' },
        images,
      ),
    ).toEqual([]);
  });

  it('matches an absent dockerfile label against the empty key value', () => {
    const images = [image({ buildRepo: REPO, buildCommit: 'abc1234' })];

    const versions = resolveEntryVersions({ kind: 'built', repo: REPO, dockerfile: '' }, images);

    expect(versions).toHaveLength(1);
    expect(versions[0].commit).toBe('abc1234');
  });

  it('ignores unlabelled images entirely', () => {
    const images = [image({ repository: 'postgres', tag: '16' })];

    expect(
      resolveEntryVersions({ kind: 'built', repo: REPO, dockerfile: '' }, images),
    ).toEqual([]);
  });

  it('collects a referenced entry versions by repository', () => {
    const images = [
      image({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-a' }),
      image({ repository: 'mediforce-golden-image', tag: 'v2', id: 'sha-b' }),
      image({ repository: 'postgres', tag: '16', id: 'sha-c' }),
    ];

    const versions = resolveEntryVersions(
      { kind: 'referenced', reference: 'mediforce-golden-image' },
      images,
    );

    expect(versions.map((v) => v.imageTag)).toEqual([
      'mediforce-golden-image:latest',
      'mediforce-golden-image:v2',
    ]);
  });

  it('carries the build workflow and namespace through when labelled', () => {
    const images = [
      image({
        buildRepo: REPO,
        buildDockerfile: 'Dockerfile',
        buildWorkflow: 'adam-review',
        buildNamespace: 'appsilon',
      }),
    ];

    const [version] = resolveEntryVersions(
      { kind: 'built', repo: REPO, dockerfile: 'Dockerfile' },
      images,
    );

    expect(version.workflow).toBe('adam-review');
    expect(version.namespace).toBe('appsilon');
  });

  it('uses cached capabilities by immutable image ID and otherwise reports unknown', () => {
    const images = [
      image({ repository: 'mediforce-golden-image', tag: 'latest', id: 'known' }),
      image({ repository: 'mediforce-golden-image', tag: 'v2', id: 'unprobed' }),
    ];

    const versions = resolveEntryVersions(
      { kind: 'referenced', reference: 'mediforce-golden-image' },
      images,
      { known: { status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] } },
    );

    expect(versions.map((version) => version.capabilities)).toEqual([
      { status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] },
      { status: 'unknown' },
    ]);
  });
});

describe('entryAvailability', () => {
  it('is unknown when the daemon could not be reached, whatever the count', () => {
    expect(entryAvailability(0, false)).toBe('unknown');
    expect(entryAvailability(3, false)).toBe('unknown');
  });

  it('is absent when the daemon answered and holds nothing for the source', () => {
    expect(entryAvailability(0, true)).toBe('absent');
  });

  it('is present when the daemon holds at least one version', () => {
    expect(entryAvailability(1, true)).toBe('present');
  });
});
