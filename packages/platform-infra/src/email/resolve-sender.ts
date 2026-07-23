import type { SendEmailFn } from '@mediforce/platform-core';
import { createMailgunSender } from './mailgun-client';
import { createSmtpSender } from './smtp-client';

/**
 * A fully-constructed email sender plus the deployment metadata callers need
 * (the `from` address for `EmailProviderInfo`, the sender display name for
 * notification services). Resolved from env in exactly one place so
 * `platform-services` and the NextAuth magic-link provider agree on which
 * provider is active and never re-derive it.
 */
export interface ResolvedEmailSender {
  send: SendEmailFn;
  from: string;
  senderName: string;
  provider: 'mailgun' | 'smtp';
}

function resolveEmailProvider(
  explicit: 'mailgun' | 'smtp' | undefined,
  mailgunConfigured: boolean,
  smtpConfigured: boolean,
): 'mailgun' | 'smtp' | null {
  if (explicit !== undefined) return explicit;
  if (mailgunConfigured && smtpConfigured) {
    throw new Error(
      'Both Mailgun and SMTP env vars are set. Set EMAIL_PROVIDER=mailgun or EMAIL_PROVIDER=smtp to disambiguate.',
    );
  }
  if (mailgunConfigured) return 'mailgun';
  if (smtpConfigured) return 'smtp';
  return null;
}

/**
 * Resolve the active email provider from env and build its `SendEmailFn`.
 *
 * Returns `null` ONLY when `MEDIFORCE_DISABLE_EMAIL === 'true'` (email off).
 * When email is enabled this fails loud — never a silent fallback — if
 * `EMAIL_PROVIDER` is invalid, both providers are configured with nothing to
 * disambiguate them, the resolved provider's required vars are incomplete, or
 * no provider is configured at all.
 */
export function resolveEmailSenderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ResolvedEmailSender | null {
  if (env.MEDIFORCE_DISABLE_EMAIL === 'true') return null;

  const mailgunApiKey = env.MAILGUN_API_KEY ?? '';
  const mailgunDomain = env.MAILGUN_DOMAIN ?? '';
  const mailgunFrom = env.MAILGUN_FROM_EMAIL ?? '';
  const mailgunSenderName = env.MAILGUN_SENDER_NAME ?? 'Mediforce';
  const mailgunConfigured = mailgunApiKey !== '' && mailgunDomain !== '' && mailgunFrom !== '';

  const smtpHost = env.SMTP_HOST ?? '';
  const smtpPort = env.SMTP_PORT ?? '';
  const smtpUser = env.SMTP_USER ?? '';
  const smtpPass = env.SMTP_PASS ?? '';
  const smtpSecure = env.SMTP_SECURE !== 'false';
  const smtpFrom = env.SMTP_FROM_EMAIL ?? '';
  const smtpSenderName = env.SMTP_SENDER_NAME ?? 'Mediforce';
  const smtpConfigured = smtpHost !== '' && smtpFrom !== '';

  const rawEmailProvider = env.EMAIL_PROVIDER || undefined;
  if (rawEmailProvider !== undefined && rawEmailProvider !== 'mailgun' && rawEmailProvider !== 'smtp') {
    throw new Error(
      `EMAIL_PROVIDER="${rawEmailProvider}" is not valid. Use "mailgun" or "smtp".`,
    );
  }
  const explicitProvider = rawEmailProvider as 'mailgun' | 'smtp' | undefined;
  const resolvedProvider = resolveEmailProvider(explicitProvider, mailgunConfigured, smtpConfigured);

  if (resolvedProvider === 'mailgun') {
    if (!mailgunConfigured) {
      const missing = [
        mailgunApiKey === '' && 'MAILGUN_API_KEY',
        mailgunDomain === '' && 'MAILGUN_DOMAIN',
        mailgunFrom === '' && 'MAILGUN_FROM_EMAIL',
      ].filter(Boolean).join(', ');
      throw new Error(
        `EMAIL_PROVIDER=mailgun but config incomplete (missing: ${missing}). ` +
        `Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.`,
      );
    }
    return {
      send: createMailgunSender({
        apiKey: mailgunApiKey,
        domain: mailgunDomain,
        defaultFrom: mailgunFrom,
        defaultSenderName: mailgunSenderName,
      }),
      from: mailgunFrom,
      senderName: mailgunSenderName,
      provider: 'mailgun',
    };
  }

  if (resolvedProvider === 'smtp') {
    if (!smtpConfigured) {
      const missing = [
        smtpHost === '' && 'SMTP_HOST',
        smtpFrom === '' && 'SMTP_FROM_EMAIL',
      ].filter(Boolean).join(', ');
      throw new Error(
        `EMAIL_PROVIDER=smtp but config incomplete (missing: ${missing}). ` +
        `Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.`,
      );
    }
    return {
      send: createSmtpSender({
        host: smtpHost,
        port: smtpPort !== '' ? Number(smtpPort) : 587,
        secure: smtpSecure,
        user: smtpUser,
        pass: smtpPass,
        defaultFrom: smtpFrom,
        defaultSenderName: smtpSenderName,
      }),
      from: smtpFrom,
      senderName: smtpSenderName,
      provider: 'smtp',
    };
  }

  throw new Error(
    'Email is enabled but no email provider is configured. ' +
    'Set MAILGUN_* or SMTP_* env vars, or set MEDIFORCE_DISABLE_EMAIL=true to start without email.',
  );
}
