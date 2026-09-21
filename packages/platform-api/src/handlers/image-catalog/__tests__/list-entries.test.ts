import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  InMemoryAuditRepository,
  InMemoryImageCatalogRepository,
} from '@mediforce/platform-core/testing';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { EMPTY_DAEMON, TEALFLOW, builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
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
  fetchImageHistory: async () => null,
}));

const { createImageCatalogEntry } = await import('../create-entry');
const { listImageCatalogEntries } = await import('../list-entries');
const { getImageCatalogEntry } = await import('../get-entry');

describe('listImageCatalogEntries handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let auditRepo: InMemoryAuditRepository;

  beforeEach(() => {
    repo = new InMemoryImageCatalogRepository();
    auditRepo = new InMemoryAuditRepository();
    daemon.value = UNREACHABLE_DAEMON;
    probe.answer = { status: 'unknown' };
    probe.calls = [];
  });

  const scopeFor = (uid: string, namespaces: string[]) =>
    createTestScope({ imageCatalogRepo: repo, auditRepo, caller: userCaller(uid, namespaces) });

  it('is empty for a namespace nobody has catalogued anything in', async () => {
    const scope = scopeFor('u-member', ['alpha']);

    expect(await listImageCatalogEntries({ namespace: 'alpha' }, scope)).toEqual({ entries: [] });
  });

  it('offers a source this namespace built that nobody has described yet', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([builtImage({ buildNamespace: 'alpha' })]);

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries).toHaveLength(1);
    expect(entries[0].origin).toBe('discovered');
    expect(entries[0].name).toBe('tealflow');
    expect(entries[0].intent).toBe('');
    // Derived from the same daemon read the stored entries use, so a discovered
    // entry arrives with its versions rather than as a bare name.
    expect(entries[0].versions.map((v) => v.imageTag)).toEqual(['mediforce-built:aaaaaaaaaaaa']);
    expect(entries[0].availability).toBe('present');
  });

  it('probes an unanswered version in the background, without holding the listing', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    probe.answer = { status: 'known', agentCapable: false, runtimes: ['bash'] };
    daemon.value = daemonWith([
      builtImage({ buildNamespace: 'alpha', id: 'sha-list-1', tag: 'list-1' }),
    ]);

    const first = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(first.entries[0].versions[0].capabilities).toEqual({ status: 'unknown' });
    expect(first.entries[0].versions[0].capabilityProbe).toBe('pending');
    await vi.waitFor(async () => {
      const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);
      expect(entries[0].versions[0].capabilities).toEqual({
        status: 'known',
        agentCapable: false,
        runtimes: ['bash'],
      });
      expect(entries[0].versions[0].capabilityProbe).toBeUndefined();
    });
    expect(probe.calls).toEqual(['mediforce-built:list-1']);
  });

  it('probes an image once for every workspace that catalogues it', async () => {
    // The default images are seeded into every workspace (ADR-0022 decision 8)
    // and rebuilt on deploy, so a per-row probe left most workspaces unprobed.
    const scope = scopeFor('u-both', ['alpha', 'beta']);
    const shared = {
      name: 'Node runtime',
      intent: 'Runs node script steps',
      source: { kind: 'referenced' as const, reference: 'mediforce-node' },
    };
    await createImageCatalogEntry({ namespace: 'alpha', ...shared }, scope);
    await createImageCatalogEntry({ namespace: 'beta', ...shared }, scope);
    probe.answer = { status: 'known', agentCapable: false, runtimes: ['sh', 'node'] };
    daemon.value = daemonWith([
      builtImage({ repository: 'mediforce-node', tag: 'latest', id: 'sha-node-rebuilt', buildRepo: undefined, buildDockerfile: undefined }),
    ]);

    await listImageCatalogEntries({ namespace: 'alpha' }, scope);
    await vi.waitFor(() => expect(probe.calls).toHaveLength(1));
    const beta = await listImageCatalogEntries({ namespace: 'beta' }, scope);

    expect(beta.entries[0].versions[0].capabilities.status).toBe('known');
    expect(probe.calls).toEqual(['mediforce-node:latest']);
  });

  it('marks a probe that could not answer as failed, and does not retry it on the next poll', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([
      builtImage({ buildNamespace: 'alpha', id: 'sha-list-failed', tag: 'list-failed' }),
    ]);

    await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    await vi.waitFor(async () => {
      const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);
      expect(entries[0].versions[0].capabilityProbe).toBe('failed');
    });
    await listImageCatalogEntries({ namespace: 'alpha' }, scope);
    expect(probe.calls).toEqual(['mediforce-built:list-failed']);
  });

  it('shows a discovered entry the capabilities an earlier entry read probed', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    probe.answer = { status: 'known', agentCapable: false, runtimes: ['bash'] };
    daemon.value = daemonWith([
      builtImage({ buildNamespace: 'alpha', id: 'sha-list-2', tag: 'list-2' }),
    ]);
    const before = await listImageCatalogEntries({ namespace: 'alpha' }, scope);
    await getImageCatalogEntry({ namespace: 'alpha', id: before.entries[0].id }, scope);

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries[0].versions[0].capabilities).toEqual({
      status: 'known',
      agentCapable: false,
      runtimes: ['bash'],
    });
  });

  it('replaces the discovered entry with the stored one, at the same id, once described', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([builtImage({ buildNamespace: 'alpha' })]);
    const before = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(before.entries[0].id);
    expect(entries[0].origin).toBe('catalogued');
    expect(entries[0].intent).toBe(TEALFLOW.intent);
  });

  it('offers nothing for an image built for another namespace', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    daemon.value = daemonWith([builtImage({ buildNamespace: 'beta' })]);

    expect(await listImageCatalogEntries({ namespace: 'alpha' }, scope)).toEqual({ entries: [] });
  });

  it('lists an entry whose image is gone from the daemon, marked absent', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
    daemon.value = EMPTY_DAEMON;

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries).toHaveLength(1);
    expect(entries[0].availability).toBe('absent');
    expect(entries[0].versions).toEqual([]);
  });

  it('annotates each entry with only the versions matching its own source', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
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
      builtImage(),
      builtImage({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-g', buildRepo: undefined, buildDockerfile: undefined }),
    ]);

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    const byName = Object.fromEntries(entries.map((e) => [e.name, e]));
    expect(byName['TealFlow agent'].versions.map((v) => v.imageTag)).toEqual([
      'mediforce-built:aaaaaaaaaaaa',
    ]);
    expect(byName['Golden image'].versions.map((v) => v.imageTag)).toEqual([
      'mediforce-golden-image:latest',
    ]);
  });

  it('groups a derived entry under the entry it was built on, roots first', async () => {
    const scope = scopeFor('u-member', ['alpha']);
    // Catalogued in the order that reads worst — the derivative first.
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, scope);
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

    const { entries } = await listImageCatalogEntries({ namespace: 'alpha' }, scope);

    expect(entries.map((entry) => entry.name)).toEqual(['Golden image', 'TealFlow agent']);
    expect(entries[0].baseEntryId).toBeNull();
    expect(entries[1].baseEntryId).toBe(entries[0].id);
    expect(entries[1].versions[0].lineage.base?.imageTag).toBe('mediforce-golden-image:latest');
  });

  it('keeps one namespace catalog out of another', async () => {
    const alpha = scopeFor('u-alpha', ['alpha']);
    const both = scopeFor('u-both', ['alpha', 'beta']);
    await createImageCatalogEntry({ namespace: 'alpha', ...TEALFLOW }, alpha);
    await createImageCatalogEntry(
      {
        namespace: 'beta',
        ...TEALFLOW,
        source: { kind: 'built', repo: 'Appsilon/other', dockerfile: '' },
      },
      both,
    );

    const alphaEntries = await listImageCatalogEntries({ namespace: 'alpha' }, alpha);

    expect(alphaEntries.entries).toHaveLength(1);
    expect(alphaEntries.entries[0].name).toBe(TEALFLOW.name);
  });

  it('refuses a caller who is not a member of the namespace', async () => {
    const scope = scopeFor('u-outsider', ['beta']);

    await expect(
      listImageCatalogEntries({ namespace: 'alpha' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
