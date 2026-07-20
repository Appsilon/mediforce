import { describe, it, expect } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { createTestScope, userCaller } from '../../../repositories/__tests__/create-test-scope';
import { ForbiddenError } from '../../../errors';
import { getConfig, getConfigByPrefix } from '../index';

describe('getConfig', () => {
  it('returns null value for unknown key', async () => {
    const scope = createTestScope();
    const result = await getConfig({ key: 'unknown.key' }, scope);
    expect(result).toEqual({ key: 'unknown.key', value: null });
  });

  it('[AUTHZ] rejects a non-system user caller — platform settings may hold secrets', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/secret');
    const scope = createTestScope({
      platformSettingsRepo,
      caller: userCaller('user-1', ['acme'], new Map([['acme', 'owner']])),
    });
    await expect(getConfig({ key: 'alert.webhook.url' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(getConfigByPrefix({ prefix: 'alert.webhook.' }, scope)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('returns the stored value for a known key', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/test');
    const scope = createTestScope({ platformSettingsRepo });
    const result = await getConfig({ key: 'alert.webhook.url' }, scope);
    expect(result).toEqual({ key: 'alert.webhook.url', value: 'https://hooks.slack.com/test' });
  });
});

describe('getConfigByPrefix', () => {
  it('returns settings matching the prefix', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await platformSettingsRepo.set('alert.webhook.type', 'slack');
    await platformSettingsRepo.set('other.key', 'value');
    const scope = createTestScope({ platformSettingsRepo });
    const result = await getConfigByPrefix({ prefix: 'alert.webhook.' }, scope);
    expect(result.settings).toHaveLength(2);
    expect(result.settings).toContainEqual({ key: 'alert.webhook.url', value: 'https://hooks.slack.com/test' });
    expect(result.settings).toContainEqual({ key: 'alert.webhook.type', value: 'slack' });
  });

  it('returns empty array for unknown prefix', async () => {
    const scope = createTestScope();
    const result = await getConfigByPrefix({ prefix: 'nonexistent.' }, scope);
    expect(result).toEqual({ settings: [] });
  });
});
