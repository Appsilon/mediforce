import { describe, it, expect } from 'vitest';
import { canonicalizeSource, deriveImageCatalogEntryId } from '../_source';

describe('image catalog source keys', () => {
  it('collapses the spellings of one repo onto one id', () => {
    const shorthand = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: 'container/Dockerfile',
    });
    const ssh = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'git@github.com:Appsilon/tealflow.git',
      dockerfile: 'container/Dockerfile',
    });
    const https = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'https://github.com/Appsilon/tealflow',
      dockerfile: 'container/Dockerfile',
    });

    expect(ssh).toBe(shorthand);
    expect(https).toBe(shorthand);
  });

  it('keys two Dockerfiles in one repo as two entries', () => {
    const cpu = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: 'container/Dockerfile',
    });
    const gpu = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: 'container/Dockerfile.gpu',
    });

    expect(gpu).not.toBe(cpu);
  });

  it('treats an absent dockerfile as the empty value deriveBuildTag folds in', () => {
    const empty = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: '',
    });
    const named = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'Appsilon/tealflow',
      dockerfile: 'Dockerfile',
    });

    expect(empty).not.toBe(named);
  });

  it('leads the id with a readable slug of the source', () => {
    expect(
      deriveImageCatalogEntryId({
        kind: 'built',
        repo: 'Appsilon/tealflow',
        dockerfile: '',
      }),
    ).toMatch(/^tealflow-[0-9a-f]{8}$/);

    expect(
      deriveImageCatalogEntryId({ kind: 'referenced', reference: 'mediforce-golden-image' }),
    ).toMatch(/^mediforce-golden-image-[0-9a-f]{8}$/);
  });

  it('never collides a built source with a referenced one that slugs the same', () => {
    const built = deriveImageCatalogEntryId({
      kind: 'built',
      repo: 'org/mediforce-golden-image',
      dockerfile: '',
    });
    const referenced = deriveImageCatalogEntryId({
      kind: 'referenced',
      reference: 'mediforce-golden-image',
    });

    expect(built).not.toBe(referenced);
  });

  it('canonicalizes a built repo to the URL the build labels carry', () => {
    expect(
      canonicalizeSource({ kind: 'built', repo: 'Appsilon/tealflow', dockerfile: 'Dockerfile' }),
    ).toEqual({
      kind: 'built',
      repo: 'git@github.com:Appsilon/tealflow.git',
      dockerfile: 'Dockerfile',
    });
  });

  it('leaves a referenced source untouched', () => {
    const source = { kind: 'referenced', reference: 'registry.example.com/my-agent' } as const;
    expect(canonicalizeSource(source)).toEqual(source);
  });
});
