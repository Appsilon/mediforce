import { parseAllowedDomains } from '@/lib/email-allowlist';

// Node-only: contains process.exit, kept out of the Edge module graph so
// Turbopack never parses it for the Edge runtime build. Dynamic-imported from
// instrumentation.ts only inside the NEXT_RUNTIME === 'nodejs' branch.
export function validateEnv(): void {
  const errors: string[] = [];
  const isProduction = process.env.NODE_ENV === 'production';

  // Production-only checks. In dev the app runs with relaxed requirements
  // (e.g. no PLATFORM_API_KEY, a throwaway AUTH_SECRET).
  if (isProduction) {
    // --- PLATFORM_API_KEY ---
    // Browser requests use the NextAuth session cookie (ADR-0002 §6);
    // server-to-server calls (cron, queue workers, CLI) use X-Api-Key.
    const apiKey = process.env.PLATFORM_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      errors.push(
        'PLATFORM_API_KEY is not set. Required for server-to-server API authentication (proxy X-Api-Key check).',
      );
    }

    // --- SECRETS_ENCRYPTION_KEY ---
    const secretsKey = process.env.SECRETS_ENCRYPTION_KEY;
    if (typeof secretsKey !== 'string' || secretsKey.length === 0) {
      errors.push(
        'SECRETS_ENCRYPTION_KEY is not set. '
        + 'Set it to a 64-character hex string (see .env.example or run scripts/bootstrap-server.py).',
      );
    } else if (!/^[0-9a-fA-F]{64}$/.test(secretsKey)) {
      errors.push(
        `SECRETS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${secretsKey.length} character(s).`,
      );
    }

    // --- AUTH_SECRET (NextAuth session encryption, ADR-0002) ---
    const authSecret = process.env.AUTH_SECRET;
    if (typeof authSecret !== 'string' || authSecret.length === 0) {
      errors.push(
        'AUTH_SECRET is not set. Required by NextAuth to sign/encrypt sessions. '
        + 'Generate one with `openssl rand -hex 32`.',
      );
    }

    // --- At least one auth provider (ADR-0002 §4) ---
    const googleEnabled = typeof process.env.GOOGLE_CLIENT_ID === 'string' && process.env.GOOGLE_CLIENT_ID !== '';
    const passwordEnabled = process.env.ENABLE_PASSWORD_AUTH === 'true';
    const oidcEnabled = typeof process.env.OIDC_ISSUER === 'string' && process.env.OIDC_ISSUER !== '';
    if (!googleEnabled && !passwordEnabled && !oidcEnabled) {
      errors.push(
        'No auth provider is configured. Set GOOGLE_CLIENT_ID, ENABLE_PASSWORD_AUTH=true, or OIDC_ISSUER '
        + '(ADR-0002 §4) — otherwise no one can sign in.',
      );
    }
  }

  // --- ALLOWED_EMAIL_DOMAINS mandatory whenever an OAuth provider is on ---
  // Deliberately OUTSIDE the production block: `isEmailDomainAllowed` fails
  // open on an empty allowlist, so this check is the only thing closing the
  // door. A staging or preview container built as `development` with Google
  // configured is exactly the case that must not be exempt (ADR-0002 §4a).
  const oauthEnabled =
    (typeof process.env.GOOGLE_CLIENT_ID === 'string' && process.env.GOOGLE_CLIENT_ID !== '')
    || (typeof process.env.OIDC_ISSUER === 'string' && process.env.OIDC_ISSUER !== '');
  if (oauthEnabled && parseAllowedDomains(process.env.ALLOWED_EMAIL_DOMAINS).length === 0) {
    errors.push(
      'An OAuth provider (GOOGLE_CLIENT_ID / OIDC_ISSUER) is configured but ALLOWED_EMAIL_DOMAINS is empty. '
      + 'Any account at the identity provider could sign in — set ALLOWED_EMAIL_DOMAINS to your domain(s) '
      + '(ADR-0002 §4a).',
    );
  }

  // --- DATABASE_URL (ADR-0001: Postgres-only, always required) ---
  // Firestore data layer was deleted; getPlatformServices unconditionally
  // constructs Postgres repos, and NextAuth's database sessions need it too.
  const dbUrl = process.env.DATABASE_URL;
  if (typeof dbUrl !== 'string' || dbUrl.length === 0) {
    errors.push(
      'DATABASE_URL is required. Set DATABASE_URL to a Postgres connection string '
      + '(e.g. postgresql://mediforce:mediforce@localhost:5432/mediforce).',
    );
  }

  // --- EMAIL PROVIDER CONFIG ---
  if (process.env.MEDIFORCE_DISABLE_EMAIL !== 'true') {
    const mailgunVars = ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_FROM_EMAIL'] as const;
    const smtpVars = ['SMTP_HOST', 'SMTP_FROM_EMAIL'] as const;
    const hasMailgun = mailgunVars.every(
      (v) => typeof process.env[v] === 'string' && process.env[v] !== '',
    );
    const hasSmtp = smtpVars.every(
      (v) => typeof process.env[v] === 'string' && process.env[v] !== '',
    );
    if (!hasMailgun && !hasSmtp) {
      errors.push(
        'Email is enabled but no email provider is configured. '
        + 'Set MAILGUN_* or SMTP_* env vars, or set MEDIFORCE_DISABLE_EMAIL=true to start without email.',
      );
    }
  }

  if (errors.length > 0) {
    const divider = '─'.repeat(60);
    const header = `\n${divider}\n  FATAL: Missing or invalid environment variables\n${divider}`;
    const body = errors.map((e, i) => `  ${i + 1}. ${e}`).join('\n');
    const footer = `${divider}\n  The server cannot start. Fix the above and restart.\n${divider}\n`;

    console.error(`${header}\n\n${body}\n\n${footer}`);
    process.exit(1);
  }
}
