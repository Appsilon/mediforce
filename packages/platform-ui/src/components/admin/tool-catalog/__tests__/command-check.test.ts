import { describe, expect, it } from 'vitest';
import type { ImageCatalogEntryView } from '@mediforce/platform-api/contract';
import { commandCheckImages, describeCommandCheck } from '../command-check';

function entry(name: string, availability: 'present' | 'absent' | 'unknown', imageTags: string[]): ImageCatalogEntryView {
  return {
    name,
    availability,
    versions: imageTags.map((imageTag) => ({ imageTag })),
  } as unknown as ImageCatalogEntryView;
}

describe('commandCheckImages', () => {
  it('lists the default agent image first, then every present catalogued version', () => {
    const images = commandCheckImages([
      entry('TealFlow agent', 'present', ['mediforce-built:aaa', 'mediforce-built:bbb']),
      entry('Gone', 'absent', ['mediforce-built:ccc']),
    ]);

    expect(images.map((image) => image.value)).toEqual([
      'mediforce-golden-image',
      'mediforce-built:aaa',
      'mediforce-built:bbb',
    ]);
    expect(images[0]?.label).toBe('Default agent image (mediforce-golden-image)');
  });

  it('does not list the default image twice when the catalog holds it', () => {
    const images = commandCheckImages([entry('Golden', 'present', ['mediforce-golden-image:latest'])]);

    expect(images.filter((image) => image.value.startsWith('mediforce-golden-image'))).toHaveLength(1);
  });
});

describe('describeCommandCheck', () => {
  it('warns only on a known absence', () => {
    expect(describeCommandCheck({ status: 'known', available: false }, 'uvx')).toEqual({
      tone: 'warning',
      text: '`uvx` is not available in this image. Steps using an agent bound to this server need an image that provides it.',
    });
  });

  it('confirms presence with the resolved path', () => {
    expect(describeCommandCheck({ status: 'known', available: true, path: '/usr/bin/npx' }, 'npx')).toEqual({
      tone: 'ok',
      text: '`npx` is available in this image (/usr/bin/npx).',
    });
  });

  it('does not vouch or warn when the answer is unknown', () => {
    expect(describeCommandCheck({ status: 'unknown' }, 'uvx')).toEqual({
      tone: 'muted',
      text: 'Could not determine whether `uvx` is available in this image.',
    });
  });
});
