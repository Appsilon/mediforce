import { describe, it, expect } from 'vitest';
import { resolveEmailSenderFromEnv } from '../resolve-sender';

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
