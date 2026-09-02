import { describe, it, expect } from 'vitest';
import { buildProvenanceLabelArgs, readProvenanceLabels } from '../image-provenance';

/** Value of a `--label key=value` pair in an argument list. */
function label(args: string[], key: string): string | undefined {
  return args.find((arg) => arg.startsWith(`${key}=`))?.slice(key.length + 1);
}

describe('buildProvenanceLabelArgs', () => {
  it('emits every known fact plus the OCI equivalents', () => {
    const args = buildProvenanceLabelArgs({
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'container/Dockerfile',
      workflow: 'sdtm-mapping',
      namespace: 'acme',
    });

    expect(label(args, 'mediforce.build.repo')).toBe('git@github.com:owner/repo.git');
    expect(label(args, 'mediforce.build.commit')).toBe('abc123');
    expect(label(args, 'mediforce.build.dockerfile')).toBe('container/Dockerfile');
    expect(label(args, 'mediforce.build.workflow')).toBe('sdtm-mapping');
    expect(label(args, 'mediforce.build.namespace')).toBe('acme');
    expect(label(args, 'org.opencontainers.image.source')).toBe('https://github.com/owner/repo');
    expect(label(args, 'org.opencontainers.image.revision')).toBe('abc123');
    expect(args.filter((arg) => arg === '--label')).toHaveLength(7);
  });

  it('omits the facts a build outside a workflow does not have', () => {
    const args = buildProvenanceLabelArgs({
      repoUrl: 'git@github.com:owner/repo.git',
      commit: 'abc123',
      dockerfile: 'Dockerfile',
    });

    expect(label(args, 'mediforce.build.workflow')).toBeUndefined();
    expect(label(args, 'mediforce.build.namespace')).toBeUndefined();
  });

  it('omits the OCI source for a repo with no browsable HTTPS form', () => {
    const args = buildProvenanceLabelArgs({
      repoUrl: '/srv/repos/local.git',
      commit: 'abc123',
      dockerfile: 'Dockerfile',
    });

    expect(label(args, 'mediforce.build.repo')).toBe('/srv/repos/local.git');
    expect(label(args, 'org.opencontainers.image.source')).toBeUndefined();
  });

  it('keeps the clone token out of the labels', () => {
    const args = buildProvenanceLabelArgs({
      repoUrl: 'https://x-access-token:SECRET@github.com/owner/private.git',
      commit: 'abc123',
      dockerfile: 'Dockerfile',
      repoToken: 'SECRET',
    });

    expect(args.join(' ')).not.toContain('SECRET');
  });
});

describe('readProvenanceLabels', () => {
  it('picks the platform build labels out of an image label map', () => {
    expect(
      readProvenanceLabels({
        'mediforce.build.repo': 'git@github.com:owner/repo.git',
        'mediforce.build.commit': 'abc123',
        'mediforce.build.dockerfile': 'container/Dockerfile',
        'mediforce.build.workflow': 'sdtm-mapping',
        'mediforce.build.namespace': 'acme',
        'org.opencontainers.image.source': 'https://github.com/owner/repo',
      }),
    ).toEqual({
      buildRepo: 'git@github.com:owner/repo.git',
      buildCommit: 'abc123',
      buildDockerfile: 'container/Dockerfile',
      buildWorkflow: 'sdtm-mapping',
      buildNamespace: 'acme',
    });
  });

  it('leaves every field undefined for an image built before the labels existed', () => {
    const cases: Array<Record<string, string> | null | undefined> = [
      null,
      undefined,
      {},
      { maintainer: 'someone' },
    ];
    for (const labels of cases) {
      expect(readProvenanceLabels(labels)).toEqual({
        buildRepo: undefined,
        buildCommit: undefined,
        buildDockerfile: undefined,
        buildWorkflow: undefined,
        buildNamespace: undefined,
      });
    }
  });
});
