import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { createTestScope } from '../../../repositories/__tests__/create-test-scope';
import { getConfig, getConfigByPrefix, setConfig, testWebhook } from '../index';

vi.mock('@mediforce/platform-infra', () => ({
  sendTestWebhook: vi.fn().mockResolvedValue({ ok: true }),
}));

describe('getConfig', () => {
  it('returns null value for unknown key', async () => {
    const scope = createTestScope();
    const result = await getConfig({ key: 'unknown.key' }, scope);
    expect(result).toEqual({ key: 'unknown.key', value: null });
  });

  it('returns the stored value for a known key', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    await platformSettingsRepo.set('alert.webhook.url', 'https://hooks.slack.com/test');
    const scope = createTestScope({ platformSettingsRepo });
    const result = await getConfig({ key: 'alert.webhook.url' }, scope);
    expect(result).toEqual({ key: 'alert.webhook.url', value: 'https://hooks.slack.com/test' });
  });
});

describe('setConfig + getConfig round-trip', () => {
  it('stores and retrieves a value', async () => {
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({ platformSettingsRepo });
    const setResult = await setConfig({ key: 'test.key', value: 'hello' }, scope);
    expect(setResult).toEqual({ ok: true });
    const getResult = await getConfig({ key: 'test.key' }, scope);
    expect(getResult).toEqual({ key: 'test.key', value: 'hello' });
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

describe('testWebhook', () => {
  it('calls sendTestWebhook and returns the result', async () => {
    const { sendTestWebhook: sendTestWebhookMock } = await import('@mediforce/platform-infra');
    const platformSettingsRepo = new InMemoryPlatformSettingsRepository();
    const scope = createTestScope({ platformSettingsRepo });
    const result = await testWebhook(undefined, scope);
    expect(sendTestWebhookMock).toHaveBeenCalledWith(platformSettingsRepo);
    expect(result).toEqual({ ok: true });
  });
});
