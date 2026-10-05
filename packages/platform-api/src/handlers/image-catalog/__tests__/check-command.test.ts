import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '../../../errors';
import {
  createTestScope,
  userCaller,
} from '../../../repositories/__tests__/create-test-scope';
import type { DaemonImageListing } from '../../system/_docker';
import { builtImage, daemonWith, UNREACHABLE_DAEMON } from './fixtures';

const daemon = vi.hoisted(() => ({
  value: { available: false, images: [] } as DaemonImageListing,
}));
const probe = vi.hoisted(() => ({
  answer: { status: 'unknown' } as { status: string; available?: boolean; path?: string },
  calls: [] as Array<{ image: string; command: string }>,
}));
vi.mock('../../system/_docker', () => ({
  fetchDaemonImages: async () => daemon.value,
  probeImageCommand: async (image: string, command: string) => {
    probe.calls.push({ image, command });
    return probe.answer;
  },
}));

const { checkImageCommand, clearImageCommandChecks } = await import('../check-command');

const GOLDEN = builtImage({ repository: 'mediforce-golden-image', tag: 'latest', id: 'sha-golden' });

describe('checkImageCommand handler', () => {
  const scope = createTestScope({ caller: userCaller('u-member', ['alpha']) });

  beforeEach(() => {
    daemon.value = daemonWith([GOLDEN]);
    probe.answer = { status: 'known', available: false };
    probe.calls = [];
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

  it('refuses a caller outside the namespace', async () => {
    await expect(
      checkImageCommand(
        { namespace: 'beta', image: 'mediforce-golden-image:latest', command: 'uvx' },
        scope,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});
