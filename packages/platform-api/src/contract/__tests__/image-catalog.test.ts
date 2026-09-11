import { describe, it, expect } from 'vitest';
import {
  BuildImageCatalogVersionInputSchema,
  CreateImageCatalogEntryInputApiSchema,
  UpdateImageCatalogEntryInputApiSchema,
} from '../image-catalog';

const build = { namespace: 'alpha', repo: 'Appsilon/tealflow', commit: 'abc1234' };
const entry = { namespace: 'alpha', name: 'TealFlow', intent: 'R exploration of ADaM datasets' };

describe('BuildImageCatalogVersionInputSchema', () => {
  it('accepts a Dockerfile outside its context while both stay in the repo', () => {
    expect(
      BuildImageCatalogVersionInputSchema.safeParse({
        ...build,
        dockerfile: '../container/Dockerfile',
        context: 'app',
      }).success,
    ).toBe(true);
  });

  it('refuses a Dockerfile that climbs out of the repo, as a 400 rather than a failed build', () => {
    expect(
      BuildImageCatalogVersionInputSchema.safeParse({
        ...build,
        dockerfile: '../../etc/Dockerfile',
        context: 'app',
      }).success,
    ).toBe(false);
    expect(
      BuildImageCatalogVersionInputSchema.safeParse({ ...build, dockerfile: '../Dockerfile' }).success,
    ).toBe(false);
  });

  it('refuses a context that climbs out of the repo', () => {
    expect(
      BuildImageCatalogVersionInputSchema.safeParse({ ...build, dockerfile: 'Dockerfile', context: '../..' })
        .success,
    ).toBe(false);
  });
});

describe('image catalog entry source input', () => {
  const escaping = {
    kind: 'built',
    repo: 'Appsilon/tealflow',
    dockerfile: '../../Dockerfile',
    context: 'app',
  } as const;

  it('refuses an escaping Dockerfile on create and on update', () => {
    expect(CreateImageCatalogEntryInputApiSchema.safeParse({ ...entry, source: escaping }).success).toBe(
      false,
    );
    expect(
      UpdateImageCatalogEntryInputApiSchema.safeParse({ namespace: 'alpha', id: 'x', source: escaping })
        .success,
    ).toBe(false);
  });

  it('accepts a referenced source untouched', () => {
    expect(
      CreateImageCatalogEntryInputApiSchema.safeParse({
        ...entry,
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      }).success,
    ).toBe(true);
  });
});
