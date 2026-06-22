// Node-only: contains process.exit, kept out of the Edge module graph so
// Turbopack never parses it for the Edge runtime build. Dynamic-imported from
// instrumentation.ts only inside the NEXT_RUNTIME === 'nodejs' branch.
export function validateEnv(existsSync: (path: string) => boolean): void {
  const errors: string[] = [];
  const isEmulatorMode = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

  // --- PLATFORM_API_KEY (production only) ---
  // Browser requests use Firebase token auth; server-to-server calls
  // (server actions, cron, queue workers) use X-Api-Key. In emulator mode
  // browser auth suffices for most flows, so we skip this check.
  if (!isEmulatorMode) {
    const apiKey = process.env.PLATFORM_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      errors.push('PLATFORM_API_KEY is not set. Required for API authentication (middleware X-Api-Key check).');
    }
  }

  // --- SECRETS_ENCRYPTION_KEY (production only) ---
  if (!isEmulatorMode) {
    const secretsKey = process.env.SECRETS_ENCRYPTION_KEY;
    if (typeof secretsKey !== 'string' || secretsKey.length === 0) {
      errors.push(
        'SECRETS_ENCRYPTION_KEY is not set. ' +
          'Set it to a 64-character hex string (see .env.example or run scripts/bootstrap-server.py).',
      );
    } else if (!/^[0-9a-fA-F]{64}$/.test(secretsKey)) {
      errors.push(
        `SECRETS_ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Got ${secretsKey.length} character(s).`,
      );
    }
  }

  // --- GOOGLE_APPLICATION_CREDENTIALS (production only) ---
  if (!isEmulatorMode) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (typeof credPath !== 'string' || credPath.length === 0) {
      errors.push(
        'GOOGLE_APPLICATION_CREDENTIALS is not set. ' +
          'Point it to your Firebase service account JSON file (e.g. /run/secrets/firebase-sa.json).',
      );
    } else if (!existsSync(credPath)) {
      errors.push(`GOOGLE_APPLICATION_CREDENTIALS points to "${credPath}" but the file does not exist.`);
    }
  }

  // --- DATABASE_URL (ADR-0001: Postgres-only) ---
  // Firestore data layer was deleted; getPlatformServices unconditionally
  // constructs Postgres repos. Missing DATABASE_URL crashes the app on
  // first request — fail fast at boot instead.
  const dbUrl = process.env.DATABASE_URL;
  if (typeof dbUrl !== 'string' || dbUrl.length === 0) {
    errors.push(
      'DATABASE_URL is required. Set DATABASE_URL to a Postgres connection string ' +
        '(e.g. postgresql://mediforce:mediforce@localhost:5432/mediforce).',
    );
  }

  // --- EMAIL PROVIDER CONFIG ---
  if (process.env.MEDIFORCE_DISABLE_EMAIL !== 'true') {
    const mailgunVars = ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_FROM_EMAIL'] as const;
    const smtpVars = ['SMTP_HOST', 'SMTP_FROM_EMAIL'] as const;
    const hasMailgun = mailgunVars.every((v) => typeof process.env[v] === 'string' && process.env[v] !== '');
    const hasSmtp = smtpVars.every((v) => typeof process.env[v] === 'string' && process.env[v] !== '');
    if (!hasMailgun && !hasSmtp) {
      errors.push(
        'Email is enabled but no email provider is configured. ' +
          'Set MAILGUN_* or SMTP_* env vars, or set MEDIFORCE_DISABLE_EMAIL=true to start without email.',
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
