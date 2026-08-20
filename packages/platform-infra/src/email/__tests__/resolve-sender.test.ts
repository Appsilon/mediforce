import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect } from 'vitest';
import { resolveEmailSenderFromEnv, isEmailDeliveryConfigured } from '../resolve-sender';

const MAILGUN_ENV: NodeJS.ProcessEnv = {
  MAILGUN_API_KEY: 'key-123',
  MAILGUN_DOMAIN: 'mg.example.com',
  MAILGUN_FROM_EMAIL: 'noreply@example.com',
  MAILGUN_SENDER_NAME: 'Example Team',
};

const SMTP_ENV: NodeJS.ProcessEnv = {
  SMTP_HOST: 'smtp.example.com',
  SMTP_FROM_EMAIL: 'noreply@example.com',
  SMTP_SENDER_NAME: 'Example Team',
};

describe('resolveEmailSenderFromEnv', () => {
  it('returns null when email is disabled', () => {
    const resolved = resolveEmailSenderFromEnv({
      MEDIFORCE_DISABLE_EMAIL: 'true',
      ...MAILGUN_ENV,
    });
    expect(resolved).toBeNull();
  });

  it('resolves the file sink when MEDIFORCE_EMAIL_TO_FILE is set, taking precedence over a provider', () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-sender-sink-'));
    const sinkPath = join(dir, 'emails.jsonl');
    try {
      const resolved = resolveEmailSenderFromEnv({
        MEDIFORCE_EMAIL_TO_FILE: sinkPath,
        ...MAILGUN_ENV,
      });
      expect(resolved?.provider).toBe('file');
      expect(resolved?.from).toBe('dev@localhost');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the file sink appends the email as a JSON line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'resolve-sender-sink-'));
    const sinkPath = join(dir, 'emails.jsonl');
    try {
      const resolved = resolveEmailSenderFromEnv({ MEDIFORCE_EMAIL_TO_FILE: sinkPath });
      const result = await resolved?.send({
        to: ['alice@example.com'],
        subject: 'Sign in',
        text: 'link https://app/callback?token=abc',
      });
      expect(result?.messageId.length).toBeGreaterThan(0);
      const written = JSON.parse(readFileSync(sinkPath, 'utf8').trim());
      expect(written.to).toEqual(['alice@example.com']);
      expect(written.subject).toBe('Sign in');
      expect(written.text).toContain('token=abc');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null when disabled even if the file sink is set', () => {
    const resolved = resolveEmailSenderFromEnv({
      MEDIFORCE_DISABLE_EMAIL: 'true',
      MEDIFORCE_EMAIL_TO_FILE: '/tmp/should-not-be-used.jsonl',
    });
    expect(resolved).toBeNull();
  });

  it('resolves Mailgun when only Mailgun is configured', () => {
    const resolved = resolveEmailSenderFromEnv({ ...MAILGUN_ENV });
    expect(resolved).not.toBeNull();
    expect(resolved?.provider).toBe('mailgun');
    expect(resolved?.from).toBe('noreply@example.com');
    expect(resolved?.senderName).toBe('Example Team');
    expect(typeof resolved?.send).toBe('function');
  });

  it('defaults senderName to Mediforce when unset', () => {
    const { MAILGUN_SENDER_NAME, ...rest } = MAILGUN_ENV;
    void MAILGUN_SENDER_NAME;
    const resolved = resolveEmailSenderFromEnv({ ...rest });
    expect(resolved?.senderName).toBe('Mediforce');
  });

  it('resolves SMTP when only SMTP is configured', () => {
    const resolved = resolveEmailSenderFromEnv({ ...SMTP_ENV });
    expect(resolved?.provider).toBe('smtp');
    expect(resolved?.from).toBe('noreply@example.com');
  });

  it('throws when both providers are configured and EMAIL_PROVIDER is absent', () => {
    expect(() => resolveEmailSenderFromEnv({ ...MAILGUN_ENV, ...SMTP_ENV })).toThrow(
      /Both Mailgun and SMTP/,
    );
  });

  it('honours an explicit EMAIL_PROVIDER when both are configured', () => {
    const resolved = resolveEmailSenderFromEnv({
      ...MAILGUN_ENV,
      ...SMTP_ENV,
      EMAIL_PROVIDER: 'smtp',
    });
    expect(resolved?.provider).toBe('smtp');
  });

  it('throws when the resolved provider config is incomplete', () => {
    expect(() =>
      resolveEmailSenderFromEnv({
        EMAIL_PROVIDER: 'mailgun',
        MAILGUN_API_KEY: 'key-123',
      }),
    ).toThrow(/config incomplete/);
  });

  it('throws on an invalid EMAIL_PROVIDER value', () => {
    expect(() =>
      resolveEmailSenderFromEnv({ ...MAILGUN_ENV, EMAIL_PROVIDER: 'sendgrid' }),
    ).toThrow(/is not valid/);
  });

  it('throws when email is enabled but no provider is configured', () => {
    expect(() => resolveEmailSenderFromEnv({})).toThrow(/no email provider is configured/);
  });
});

describe('isEmailDeliveryConfigured', () => {
  it('is true whenever a provider resolves, regardless of which sign-in methods are on', () => {
    expect(isEmailDeliveryConfigured(MAILGUN_ENV)).toBe(true);
    expect(isEmailDeliveryConfigured({ ...SMTP_ENV, ENABLE_MAGIC_LINK: 'false' })).toBe(true);
  });

  it('is false when email is disabled', () => {
    expect(isEmailDeliveryConfigured({ MEDIFORCE_DISABLE_EMAIL: 'true', ...MAILGUN_ENV })).toBe(
      false,
    );
  });

  // The display flag must degrade rather than propagate the boot-time throw:
  // `/api/auth/magic-link-login` is a public GET on the login page.
  it('is false — never throwing — on a misconfigured deployment', () => {
    expect(isEmailDeliveryConfigured({})).toBe(false);
    expect(isEmailDeliveryConfigured({ EMAIL_PROVIDER: 'mailgun', MAILGUN_API_KEY: 'k' })).toBe(
      false,
    );
    expect(isEmailDeliveryConfigured({ ...MAILGUN_ENV, ...SMTP_ENV })).toBe(false);
  });
});
