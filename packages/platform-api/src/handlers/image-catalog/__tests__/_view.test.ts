import { describe, it, expect, vi } from 'vitest';
import type { ImageCatalogEntry } from '@mediforce/platform-core';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { EMPTY_DAEMON, TEALFLOW_REPO_URL, builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCapabilities: async () => ({ status: 'unknown' }),
  fetchImageHistory: async () => null,
}));

const { toEntryViews } = await import('../_view');

const ENTRY: ImageCatalogEntry = {
  id: 'tealflow-1a2b3c4d',
  name: 'TealFlow agent',
  intent: 'R-based interactive exploration of ADaM datasets',
  source: { kind: 'built', repo: TEALFLOW_REPO_URL, dockerfile: 'container/Dockerfile' },
  capabilities: {},
};

describe('toEntryViews', () => {
  it('annotates a stored entry with the versions the daemon holds', async () => {
    daemon.value = daemonWith([builtImage({ tag: 'newer' }), builtImage({ tag: 'older', id: 'sha-2' })]);

    const [view] = await toEntryViews([ENTRY], createTestScope({}));

    expect(view.availability).toBe('present');
    expect(view.versions.map((v) => v.imageTag)).toEqual([
      'mediforce-built:newer',
      'mediforce-built:older',
    ]);
    expect(view.versions.map((v) => v.capabilities)).toEqual([
      { status: 'unknown' },
      { status: 'unknown' },
    ]);
    expect(view.intent).toBe(ENTRY.intent);
  });

  it('marks an entry absent when the daemon answered and holds nothing for it', async () => {
    daemon.value = EMPTY_DAEMON;

    const [view] = await toEntryViews([ENTRY], createTestScope({}));

    expect(view.availability).toBe('absent');
    expect(view.versions).toEqual([]);
  });

  it('marks every entry unknown when the daemon could not be reached', async () => {
    daemon.value = UNREACHABLE_DAEMON;

    const views = await toEntryViews([ENTRY, { ...ENTRY, id: 'other' }], createTestScope({}));

    expect(views.map((v) => v.availability)).toEqual(['unknown', 'unknown']);
  });
});
