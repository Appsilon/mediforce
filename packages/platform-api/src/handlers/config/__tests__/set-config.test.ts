import { describe, it, expect } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import { getConfig, setConfig } from '../index';

describe('setConfig', () => {
  it('stores and retrieves a value', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({ platformSettingsRepo });
    const setResult = await setConfig({ key: 'test.key', value: 'hello' }, scope);
    expect(setResult).toEqual({ ok: true });
    const getResult = await getConfig({ key: 'test.key' }, scope);
    expect(getResult).toEqual({ key: 'test.key', value: 'hello' });
  });
});
