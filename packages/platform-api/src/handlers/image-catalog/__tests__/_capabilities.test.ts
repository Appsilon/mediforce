import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryImageCatalogRepository } from '@mediforce/platform-core/testing';
import type { ImageCatalogEntry } from '@mediforce/platform-core';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { builtImage, daemonWith, TEALFLOW_REPO_URL, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
const probe = vi.hoisted(() => vi.fn());
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCapabilities: probe,
}));

const { refreshEntryCapabilities } = await import('../_capabilities');

const entry: ImageCatalogEntry = {
  id: 'tealflow-1a2b3c4d',
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: TEALFLOW_REPO_URL, dockerfile: 'container/Dockerfile' },
  capabilities: {},
};

describe('refreshEntryCapabilities', () => {
  beforeEach(() => {
    probe.mockReset();
  });

  it('probes registered versions once and stores the result by image ID', async () => {
    const repo = new InMemoryImageCatalogRepository();
    const scope = createTestScope({ imageCatalogRepo: repo });
    daemon.value = daemonWith([builtImage({ id: 'sha-image', tag: 'v1' })]);
    probe.mockResolvedValue({ status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] });

    const result = await refreshEntryCapabilities('alpha', entry, scope);

    expect(probe).toHaveBeenCalledWith('mediforce-built:v1');
    expect(result.capabilities).toEqual({
      'sha-image': { status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] },
    });
    expect(await repo.getById('alpha', entry.id)).toEqual(result);
  });

  it('keeps a concurrent edit made while the probe ran', async () => {
    const repo = new InMemoryImageCatalogRepository();
    const scope = createTestScope({ imageCatalogRepo: repo });
    daemon.value = daemonWith([builtImage({ id: 'sha-image', tag: 'v1' })]);
    await repo.upsert('alpha', entry);
    // The rename lands after `entry` was read and before the probe returns —
    // the write below must carry it, not the name the caller started from.
    probe.mockImplementation(async () => {
      await repo.upsert('alpha', { ...entry, name: 'Renamed by someone else' });
      return { status: 'known', agentCapable: true, runtimes: ['claude', 'bash'] };
    });

    const result = await refreshEntryCapabilities('alpha', entry, scope);

    expect(result.name).toBe('Renamed by someone else');
    expect(result.capabilities['sha-image']).toEqual({
      status: 'known', agentCapable: true, runtimes: ['claude', 'bash'],
    });
  });

  it('stops probing an entry once its whole-refresh budget is spent', async () => {
    vi.useFakeTimers();
    const scope = createTestScope({ imageCatalogRepo: new InMemoryImageCatalogRepository() });
    daemon.value = daemonWith([
      builtImage({ id: 'one', tag: 'v1' }),
      builtImage({ id: 'two', tag: 'v2' }),
      builtImage({ id: 'three', tag: 'v3' }),
    ]);
    probe.mockImplementation(async () => {
      vi.advanceTimersByTime(10_000);
      return { status: 'unknown' };
    });

    const result = await refreshEntryCapabilities('alpha', entry, scope);

    expect(probe).toHaveBeenCalledTimes(2);
    expect(Object.keys(result.capabilities)).toEqual(['one', 'two']);
    vi.useRealTimers();
  });

  it('does not start a probe when the daemon is unavailable', async () => {
    const scope = createTestScope({ imageCatalogRepo: new InMemoryImageCatalogRepository() });
    daemon.value = UNREACHABLE_DAEMON;

    expect(await refreshEntryCapabilities('alpha', entry, scope)).toEqual(entry);
    expect(probe).not.toHaveBeenCalled();
  });
});
