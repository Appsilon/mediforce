import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InMemoryPlatformSettingsRepository } from '@mediforce/platform-core/testing';
import { sendSyncFailureWebhook, sendTestWebhook } from '../sync-alert-webhook';

const CONTEXT = {
  errorMessage: 'OpenRouter API timeout',
  attemptCount: 4,
  timestamp: '2026-06-02T03:00:00.000Z',
};

describe('sendSyncFailureWebhook', () => {
  let settings: InMemoryPlatformSettingsRepository;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings = new InMemoryPlatformSettingsRepository();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns without HTTP call when webhook is disabled', async () => {
    await settings.set('alert.webhook.enabled', 'false');
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns without HTTP call when webhook URL is not configured', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Slack-formatted payload when type is "slack"', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await settings.set('alert.webhook.type', 'slack');
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://hooks.slack.com/test');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body).toHaveProperty('text');
    expect(body.text).toContain('Model Registry Sync Failed');
    expect(body.text).toContain('4');
    expect(body.text).toContain('OpenRouter API timeout');
    expect(body.text).toContain('2026-06-02T03:00:00.000Z');
    expect(body.text).toContain('audit log');
  });

  it('sends Discord-formatted payload when type is "discord"', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await settings.set('alert.webhook.url', 'https://discord.com/api/webhooks/test');
    await settings.set('alert.webhook.type', 'discord');
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { content: string };
    expect(body).toHaveProperty('content');
    expect(body.content).toContain('Model Registry Sync Failed');
    expect(body.content).toContain('4');
    expect(body.content).toContain('OpenRouter API timeout');
  });

  it('defaults to Slack format when type is missing', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    // no alert.webhook.type set
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty('text');
    expect(body).not.toHaveProperty('content');
  });

  it('defaults to Slack format when type is unknown', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await settings.set('alert.webhook.type', 'teams');
    await sendSyncFailureWebhook(settings, CONTEXT);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toHaveProperty('text');
  });

  it('catches and does not rethrow fetch errors', async () => {
    await settings.set('alert.webhook.enabled', 'true');
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    fetchMock.mockRejectedValueOnce(new Error('Network error'));
    // Must not throw
    await expect(sendSyncFailureWebhook(settings, CONTEXT)).resolves.toBeUndefined();
  });
});

describe('sendTestWebhook', () => {
  let settings: InMemoryPlatformSettingsRepository;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    settings = new InMemoryPlatformSettingsRepository();
    fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns { ok: false, error } when no URL configured', async () => {
    const result = await sendTestWebhook(settings);
    expect(result).toEqual({ ok: false, error: 'No webhook URL configured' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends test message and returns { ok: true } on success', async () => {
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    await settings.set('alert.webhook.type', 'slack');
    const result = await sendTestWebhook(settings);
    expect(result).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { text: string };
    expect(body.text).toContain('Mediforce webhook test');
  });

  it('returns { ok: false, error } when fetch throws', async () => {
    await settings.set('alert.webhook.url', 'https://hooks.slack.com/test');
    fetchMock.mockRejectedValueOnce(new Error('Timeout'));
    const result = await sendTestWebhook(settings);
    expect(result).toEqual({ ok: false, error: 'Timeout' });
  });
});
