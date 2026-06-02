import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { getConfig, getConfigByPrefix, setConfig, testWebhook } from '../index';

vi.mock('@mediforce/platform-infra', () => ({
  sendTestWebhook: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('getConfig', () => {
  it('returns null value for unknown key', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const result = await getConfig({ platformSettingsRepo }, { key: 'unknown.key' });
    expect(result).toEqual({ key: 'unknown.key', value: null });
  });

  it('returns the stored value for a known key', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/test');
    const result = await getConfig({ platformSettingsRepo }, { key: 'alert.webhook.url' });
    expect(result).toEqual({ key: 'alert.webhook.url', value: 'https://hooks.slack.com/test' });
  });
});

describe('setConfig + getConfig round-trip', () => {
  it('stores and retrieves a value', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const setResult = await setConfig({ platformSettingsRepo }, { key: 'test.key', value: 'hello' });
    expect(setResult).toEqual({ ok: true });
    const getResult = await getConfig({ platformSettingsRepo }, { key: 'test.key' });
    expect(getResult).toEqual({ key: 'test.key', value: 'hello' });
  });
});

describe('getConfigByPrefix', () => {
  it('returns settings matching the prefix', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await platformSettingsRepo.set('alert.webhook.type', 'slack');
    await platformSettingsRepo.set('other.key', 'value');
    const result = await getConfigByPrefix({ platformSettingsRepo }, { prefix: 'alert.webhook.' });
    expect(result.settings).toHaveLength(2);
    expect(result.settings).toContainEqual({ key: 'alert.webhook.url', value: 'https://hooks.slack.com/test' });
    expect(result.settings).toContainEqual({ key: 'alert.webhook.type', value: 'slack' });
  });

  it('returns empty array for unknown prefix', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const result = await getConfigByPrefix({ platformSettingsRepo }, { prefix: 'nonexistent.' });
    expect(result).toEqual({ settings: [] });
  });
});

describe('testWebhook', () => {
  it('calls sendTestWebhook and returns the result', async () => {
    const { sendTestWebhook } = await import('@mediforce/platform-infra');
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const result = await testWebhook({ platformSettingsRepo });
    expect(sendTestWebhook).toHaveBeenCalledWith(platformSettingsRepo);
    expect(result).toEqual({ ok: true });
  });
});
