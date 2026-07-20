import { describe, it, expect } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ForbiddenError } from '../../../errors';
import { getConfig, setConfig } from '../index';

describe('setConfig', () => {
  it('stores and retrieves a value for a system-actor caller', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({ platformSettingsRepo });
    const setResult = await setConfig({ key: 'test.key', value: 'hello' }, scope);
    expect(setResult).toEqual({ ok: true });
    const getResult = await getConfig({ key: 'test.key' }, scope);
    expect(getResult).toEqual({ key: 'test.key', value: 'hello' });
  });

  it('[AUTHZ] rejects a non-system user caller — platform settings are operator-only', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({
      platformSettingsRepo,
      caller: userCaller('user-1', ['acme'], new Map([['acme', 'owner']])),
    });
    await expect(
      setConfig({ key: 'platform.baseUrl', value: 'https://evil.example' }, scope),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(await platformSettingsRepo.get('platform.baseUrl')).toBeNull();
  });
});
