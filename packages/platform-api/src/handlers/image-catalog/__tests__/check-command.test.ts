import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import { InMemoryImageCatalogRepository } from '@mediforce/platform-core/testing';
import type { DaemonImageListing } from '../../system/_docker';
import { builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
const probe = vi.hoisted(() => ({
  answer: { status: 'unknown' } as { status: string; available?: boolean; path?: string },
  calls: [] as Array<{ image: string; command: string }>,
  onProbe: undefined as (() => Promise<void>) | undefined,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCommand: async (image: string, command: string) => {
    probe.calls.push({ image, command });
    await probe.onProbe?.();
    return probe.answer;
  },
}));

const { checkImageCommand, clearImageCommandChecks } = await import('../check-command');

const GOLDEN = builtImage({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-golden' });

describe('checkImageCommand handler', () => {
  let repo: InMemoryImageCatalogRepository;
  let scope: ReturnType<typeof createTestScope>;

  const catalogue = (namespace: string, reference: string) =>
    repo.upsert(namespace, {
      id: `ref-${namespace}-${reference}`,
      name: reference,
      intent: 'test image',
      source: { kind: 'referenced', reference },
      capabilities: {},
    });

  beforeEach(async () => {
    repo = new InMemoryImageCatalogRepository();
    scope = createTestScope({ imageCatalogRepo: repo, caller: userCaller('u-member', ['alpha']) });
    await catalogue('alpha', 'mediforce-golden-image');
    daemon.value = daemonWith([GOLDEN]);
    probe.answer = { status: 'known', available: false };
    probe.calls = [];
    probe.onProbe = undefined;
    clearImageCommandChecks();
  });

  it('asks the daemon image whether it resolves the command', async () => {
    const output = await checkImageCommand(
      { namespace: 'alpha', image: 'mediforce-golden-image:latest', command: 'uvx' },
      scope,
    );

    expect(output).toEqual({ status: 'known', available: false });
    expect(probe.calls).toEqual([{ image: 'mediforce-golden-image:latest', command: 'uvx' }]);
  });

  it('accepts a bare repository as its :latest tag, which is how a step names the default image', async () => {
    await checkImageCommand({ namespace: 'alpha', image: 'mediforce-golden-image', command: 'npx' }, scope);

    expect(probe.calls).toEqual([{ image: 'mediforce-golden-image:latest', command: 'npx' }]);
  });

  it('does not probe the same image and command twice', async () => {
    probe.answer = { status: 'known', available: true, path: '/usr/bin/npx' };
    const input = { namespace: 'alpha', image: 'mediforce-golden-image:latest', command: 'npx' };

    await checkImageCommand(input, scope);
    const again = await checkImageCommand(input, scope);

    expect(again).toEqual({ status: 'known', available: true, path: '/usr/bin/npx' });
    expect(probe.calls).toHaveLength(1);
  });

  it('shares one probe between concurrent first asks', async () => {
    const input = { namespace: 'alpha', image: 'mediforce-golden-image:latest', command: 'uvx' };

    await Promise.all([checkImageCommand(input, scope), checkImageCommand(input, scope)]);

    expect(probe.calls).toHaveLength(1);
  });

  it('keeps asking after an unknown answer: nothing was learned', async () => {
    probe.answer = { status: 'unknown' };
    const input = { namespace: 'alpha', image: 'mediforce-golden-image:latest', command: 'uvx' };

    await checkImageCommand(input, scope);
    await checkImageCommand(input, scope);

    expect(probe.calls).toHaveLength(2);
  });

  it('answers unknown, not an error, when no daemon can be reached', async () => {
    daemon.value = UNREACHABLE_DAEMON;

    const output = await checkImageCommand(
      { namespace: 'alpha', image: 'mediforce-golden-image:latest', command: 'uvx' },
      scope,
    );

    expect(output).toEqual({ status: 'unknown' });
    expect(probe.calls).toHaveLength(0);
  });

  it('answers unknown for an image the daemon does not hold, so a reference is never passed to docker unchecked', async () => {
    await expect(
      checkImageCommand({ namespace: 'alpha', image: '--privileged', command: 'uvx' }, scope),
    ).resolves.toEqual({ status: 'unknown' });
    expect(probe.calls).toHaveLength(0);
  });

  it('answers unknown for an image only another workspace catalogues, so tenants cannot probe each other', async () => {
    const other = builtImage({ repository: 'beta-private', tag: 'v1', id: 'sha-beta' });
    daemon.value = daemonWith([GOLDEN, other]);
    await catalogue('beta', 'beta-private');

    await expect(
      checkImageCommand({ namespace: 'alpha', image: 'beta-private:v1', command: 'uvx' }, scope),
    ).resolves.toEqual({ status: 'unknown' });
    expect(probe.calls).toHaveLength(0);
  });

  it('reads a registry port as part of the repository, so an untagged reference means :latest', async () => {
    const registry = builtImage({ repository: 'localhost:5000/team/agent', tag: 'latest', id: 'sha-reg' });
    daemon.value = daemonWith([GOLDEN, registry]);
    await catalogue('alpha', 'localhost:5000/team/agent');

    await checkImageCommand({ namespace: 'alpha', image: 'localhost:5000/team/agent', command: 'uvx' }, scope);

    expect(probe.calls).toEqual([{ image: 'localhost:5000/team/agent:latest', command: 'uvx' }]);
  });

  it('starts one container at a time, however many distinct commands are asked', async () => {
    let running = 0;
    let peak = 0;
    const input = (command: string) => ({ namespace: 'alpha', image: 'mediforce-golden-image', command });
    probe.onProbe = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };

    await Promise.all(['uvx', 'npx', 'node', 'uv'].map((command) => checkImageCommand(input(command), scope)));

    expect(peak).toBe(1);
    expect(probe.calls).toHaveLength(4);
  });

  it('forgets answers for images the daemon no longer holds', async () => {
    await checkImageCommand({ namespace: 'alpha', image: 'mediforce-golden-image', command: 'uvx' }, scope);
    daemon.value = daemonWith([builtImage({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-rebuilt' })]);
    await checkImageCommand({ namespace: 'alpha', image: 'mediforce-golden-image', command: 'uvx' }, scope);
    daemon.value = daemonWith([GOLDEN]);
    await checkImageCommand({ namespace: 'alpha', image: 'mediforce-golden-image', command: 'uvx' }, scope);

    expect(probe.calls).toHaveLength(3);
  });

  it('refuses a caller outside the namespace', async () => {
    await expect(
      checkImageCommand(
        { namespace: 'beta', image: 'mediforce-golden-image:latest', command: 'uvx' },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
