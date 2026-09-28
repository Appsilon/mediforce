import { describe, it, expect } from 'vitest';
import {
  BuildImageCatalogVersionInputSchema,
  CreateImageCatalogEntryInputApiSchema,
  UpdateImageCatalogEntryInputApiSchema,
  UploadImageCatalogVersionInputSchema,
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

describe('UploadImageCatalogVersionInputSchema', () => {
  const upload = {
    namespace: 'alpha',
    reference: 'alpha/agent',
    context: new Uint8Array([0]),
  };

  it('accepts a reference under the namespace, with the tag and Dockerfile optional', () => {
    const parsed = UploadImageCatalogVersionInputSchema.parse(upload);

    expect(parsed.tag).toBeUndefined();
    expect(parsed.dockerfile).toBe('');
  });

  it('refuses a reference outside the namespace, which could tag over another workspace\'s image', () => {
    for (const reference of ['agent', 'beta/agent', 'alphabet/agent', 'postgres']) {
      const result = UploadImageCatalogVersionInputSchema.safeParse({ ...upload, reference });
      expect(result.success, reference).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('alpha/');
    }
  });

  it('refuses what Docker would refuse as a name or a tag', () => {
    expect(UploadImageCatalogVersionInputSchema.safeParse({ ...upload, reference: 'alpha/Agent' }).success).toBe(false);
    expect(UploadImageCatalogVersionInputSchema.safeParse({ ...upload, reference: 'alpha/agent:v1' }).success).toBe(false);
    expect(UploadImageCatalogVersionInputSchema.safeParse({ ...upload, tag: '-v1' }).success).toBe(false);
    expect(UploadImageCatalogVersionInputSchema.safeParse({ ...upload, tag: 'v1.2_rc-3' }).success).toBe(true);
  });

  it('refuses a Dockerfile outside the uploaded context', () => {
    expect(
      UploadImageCatalogVersionInputSchema.safeParse({ ...upload, dockerfile: '../Dockerfile' }).success,
    ).toBe(false);
  });

  it('needs the context to be the archive bytes', () => {
    expect(UploadImageCatalogVersionInputSchema.safeParse({ ...upload, context: 'Dockerfile' }).success).toBe(false);
  });
});
