import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InMemoryImageCatalogRepository } from '@mediforce/platform-core/testing';
import type { ImageCatalogEntry } from '@mediforce/platform-core';
import type { DockerInfoResponse } from '../../../contract/system';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import { builtImage, daemonWith, TEALFLOW_REPO_URL } from './fixtures';

const daemon = vi.hoisted(() => ({ value: { available: false } as DockerInfoResponse }));
const probe = vi.hoisted(() => vi.fn());
vi.mock('../../system/get-docker-info', () => ({ getDockerInfo: async () => daemon.value }));
vi.mock('../../system/_docker', () => ({ probeImageCapabilities: probe }));

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

  it('does not start a probe when the daemon is unavailable', async () => {
    const scope = createTestScope({ imageCatalogRepo: new InMemoryImageCatalogRepository() });
    daemon.value = { available: false };

    expect(await refreshEntryCapabilities('alpha', entry, scope)).toEqual(entry);
    expect(probe).not.toHaveBeenCalled();
  });
});
