import type { PlatformSettingsRepository } from '@mediforce/platform-core';

export interface SyncFailureContext {
  errorMessage: string;
  attemptCount: number;
  timestamp: string;
}

export interface TestWebhookResult {
  ok: boolean;
  error?: string;
}

function buildSlackPayload(context: SyncFailureContext): Record<string, string> {
  return {
    text:
      `:warning: *Model Registry Sync Failed*\n` +
      `Failed after ${context.attemptCount} retries.\n` +
      `*Error:* ${context.errorMessage}\n` +
      `*Time:* ${context.timestamp}\n` +
      `_Check the audit log for full retry timeline._`,
  };
}

function buildDiscordPayload(context: SyncFailureContext): Record<string, string> {
  return {
    content:
      `**Model Registry Sync Failed**\n` +
      `Failed after ${context.attemptCount} retries.\n` +
      `**Error:** ${context.errorMessage}\n` +
      `**Time:** ${context.timestamp}\n` +
      `*Check the audit log for full retry timeline.*`,
  };
}

function buildSlackTestPayload(): Record<string, string> {
  return { text: ':white_check_mark: Mediforce webhook test -- configuration is working.' };
}

function buildDiscordTestPayload(): Record<string, string> {
  return { content: 'Mediforce webhook test -- configuration is working.' };
}

/**
 * Sends a sync failure webhook notification.
 * Fire-and-forget — fetch errors are caught and logged, never rethrown.
 * Only fires when alert.webhook.enabled = "true" AND alert.webhook.url is set.
 */
export async function sendSyncFailureWebhook(
  settingsRepo: PlatformSettingsRepository,
  context: SyncFailureContext,
): Promise<void> {
  const [enabled, url, type] = await Promise.all([
    settingsRepo.get('alert.webhook.enabled'),
    settingsRepo.get('alert.webhook.url'),
    settingsRepo.get('alert.webhook.type'),
  ]);

  if (enabled !== 'true' || !url) return;

  const payload = type === 'discord' ? buildDiscordPayload(context) : buildSlackPayload(context);

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[sync-alert-webhook] Failed to send failure webhook:', err);
  }
}

/**
 * Sends a test webhook notification.
 * Returns { ok: true } on success, { ok: false, error } on failure.
 */
export async function sendTestWebhook(
  settingsRepo: PlatformSettingsRepository,
): Promise<TestWebhookResult> {
  const [url, type] = await Promise.all([
    settingsRepo.get('alert.webhook.url'),
    settingsRepo.get('alert.webhook.type'),
  ]);

  if (!url) return { ok: false, error: 'No webhook URL configured' };

  const payload = type === 'discord' ? buildDiscordTestPayload() : buildSlackTestPayload();

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}
