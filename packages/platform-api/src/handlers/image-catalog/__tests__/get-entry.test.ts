import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError, NotFoundError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { EMPTY_DAEMON, TEALFLOW, builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
/** The layer summary each image id has, by image id — an id absent from it is
 *  one the daemon could not answer for. Mocked rather than left to the real
 *  module, which would otherwise reach for a Docker socket or the worker. */
const history = vi.hoisted(() => ({ value: new Map<string, { command: string; size: string }[]>() }));
/** What a probe answers, and how many were run — the lazy read path is defined
 *  by which versions it probes and which it leaves alone. */
const probe = vi.hoisted(() => ({
  answer: { status: 'unknown' } as { status: string; agentCapable?: boolean; runtimes?: string[] },
  calls: [] as string[],
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCapabilities: async (image: string) => {
    probe.calls.push(image);
    return probe.answer;
  },
  fetchImageHistory: async (image: string) => history.value.get(image) ?? null,
}));

const { createImageCatalogEntry } = await import('../create-entry');
const { getImageCatalogEntry } = await import('../get-entry');
const { listImageCatalogEntries } = await import('../list-entries');

describe('getImageCatalogEntry handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = UNREACHABLE_DAEMON;
    history.value = new Map();
    probe.answer = { status: 'unknown' };
    probe.calls = [];
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  async function seedEntry() {
    const scope = scopeFor('u-member', ['alpha']);
    const { entry } = await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    return { scope, id: entry.id };
  }

  it('probes on read a version that was catalogued before its image existed', async () => {
    // The ordinary build-mode sequence: the entry is catalogued while the
    // daemon holds nothing, and the image only appears on the first run. No
    // write follows that build, so without a probe here the entry would read
    // "Capabilities not probed" for ever.
    const { scope, id } = await seedEntry();
    expect(probe.calls).toEqual([]);

    probe.answer = { status: 'known', agentCapable: true, runtimes: ['Rscript'] };
    daemon.value = daemonWith([builtImage({ tag: 'built-later' })]);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(probe.calls).toEqual(['mediforce-built:built-later']);
    expect(entry.versions[0].capabilities).toEqual({
      status: 'known',
      agentCapable: true,
      runtimes: ['Rscript'],
    });
  });

  it('does not re-probe a version whose probe already answered unknown', async () => {
    // A read runs on a 30 s poll. Retrying every version that is not `known`
    // would turn an image the probe cannot answer for into a container start
    // per poll, for as long as anyone leaves the card open.
    const { scope, id } = await seedEntry();
    daemon.value = daemonWith([builtImage({ tag: 'unprobeable' })]);

    await getImageCatalogEntry({ namespace: 'alpha', id }, scope);
    expect(probe.calls).toHaveLength(1);

    await getImageCatalogEntry({ namespace: 'alpha', id }, scope);
    expect(probe.calls).toHaveLength(1);
  });

  it('404s an id nobody catalogued', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    await expect(
      getImageCatalogEntry({ namespace: 'alpha', id: 'nope-00000000' }, scope),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('resolves a discovered id rather than 404ing it', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([builtImage({ buildNamespace: 'alpha' })]);
    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id: entries[0].id }, scope);

    expect(entry.origin).toBe('discovered');
    expect(entry.intent).toBe('');
    expect(entry.versions.map((v) => v.imageTag)).toEqual(['mediforce-built:aaaaaaaaaaaa']);
  });

  // Every case below keeps its own image id: the memo behind a discovered
  // entry's probe is module state keyed by image id, so two tests sharing one
  // id would see each other's probes.
  it('probes a discovered entry on read, exactly like a stored one', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    probe.answer = { status: 'known', agentCapable: true, runtimes: ['bash', 'claude'] };
    daemon.value = daemonWith([
      builtImage({ buildNamespace: 'alpha', id: 'sha-probe-1', tag: 'probe-1' }),
    ]);
    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id: entries[0].id }, scope);

    expect(probe.calls).toEqual(['mediforce-built:probe-1']);
    expect(entry.versions[0].capabilities).toEqual({
      status: 'known',
      agentCapable: true,
      runtimes: ['bash', 'claude'],
    });
  });

  it('does not re-probe a discovered version it has already answered for', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([
      builtImage({ buildNamespace: 'alpha', id: 'sha-probe-2', tag: 'probe-2' }),
    ]);
    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);
    await getImageCatalogEntry({ namespace: 'alpha', id: entries[0].id }, scope);
    probe.calls = [];

    // The second read is the 30 s poll of a card left open: an image whose
    // probe already answered — `unknown` included — must not start another
    // container.
    await getImageCatalogEntry({ namespace: 'alpha', id: entries[0].id }, scope);

    expect(probe.calls).toEqual([]);
  });

  it('returns the entry with its versions when the daemon holds the image', async () => {
    const { scope, id } = await seedEntry();
    daemon.value = daemonWith([builtImage({ tag: 'newer' }), builtImage({ tag: 'older', id: 'sha-2' })]);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('present');
    expect(entry.versions.map((v) => v.imageTag)).toEqual([
      'mediforce-built:newer',
      'mediforce-built:older',
    ]);
  });

  it('names a base that is another entry — resolved against the whole catalog, not this row', async () => {
    const { scope, id } = await seedEntry();
    const { entry: golden } = await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      },
      scope,
    );
    daemon.value = daemonWith([
      builtImage({ baseImageId: 'sha-g' }),
      builtImage({
        repository: 'mediforce-golden-image',
        tag: 'latest',
        id: 'sha-g',
        buildRepo: undefined,
        buildDockerfile: undefined,
      }),
    ]);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.baseEntryId).toBe(golden.id);
    expect(entry.versions[0].lineage.base?.imageTag).toBe('mediforce-golden-image:latest');
  });

  it('reports the layer summary the image adds over its base, and omits it when the base read failed', async () => {
    const { scope, id } = await seedEntry();
    await createImageCatalogEntry(
      {
        namespace: 'alpha',
        name: 'Golden image',
        intent: 'The deployment agent-capable base image',
        source: { kind: 'referenced', reference: 'mediforce-golden-image' },
      },
      scope,
    );
    daemon.value = daemonWith([
      builtImage({ baseImageId: 'sha-g' }),
      builtImage({
        repository: 'mediforce-golden-image',
        tag: 'latest',
        id: 'sha-g',
        buildRepo: undefined,
        buildDockerfile: undefined,
      }),
    ]);
    const baseSummary = [{ command: 'RUN install R', size: '1GB' }];
    history.value.set('sha-g', baseSummary);
    history.value.set('sha-1', [...baseSummary, { command: 'COPY mcp /app/mcp', size: '4kB' }]);

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.versions[0].lineage.addedSteps).toEqual([
      { command: 'COPY mcp /app/mcp', size: '4kB' },
    ]);

    // The base's own summary gone, the child's still there: publishing the
    // difference now would credit the child with everything it inherited.
    history.value.delete('sha-g');

    const { entry: reread } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(reread.versions[0].lineage.addedSteps).toBeUndefined();
  });

  it('still returns an entry whose image is gone from the daemon, marked absent', async () => {
    const { scope, id } = await seedEntry();
    daemon.value = EMPTY_DAEMON;

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('absent');
    expect(entry.versions).toEqual([]);
  });

  it('degrades to unknown rather than failing when the daemon is unreachable', async () => {
    const { scope, id } = await seedEntry();

    const { entry } = await getImageCatalogEntry({ namespace: 'alpha', id }, scope);

    expect(entry.availability).toBe('unknown');
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const { id } = await seedEntry();
    const outsider = scopeFor('u-outsider', ['beta']);

    await expect(
      getImageCatalogEntry({ namespace: 'alpha', id }, outsider),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
