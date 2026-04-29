// webpackIgnore: true on import() (not require()) is what webpack 5 actually
// supports for skipping bundling. register() is async so we can await it.
function validateEnv(existsSync: (path: string) => boolean): void {
  const errors: string[] = [];
  const isEmulatorMode = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

  // --- PLATFORM_API_KEY (production only) ---
  // Browser requests use Firebase token auth; server-to-server calls
  // (server actions, cron, queue workers) use X-Api-Key. In emulator mode
  // browser auth suffices for most flows, so we skip this check.
  if (!isEmulatorMode) {
    const apiKey = process.env.PLATFORM_API_KEY;
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      errors.push(
        'PLATFORM_API_KEY is not set. Required for API authentication (middleware X-Api-Key check).',
      );
    }
  }

  // --- SECRETS_ENCRYPTION_KEY (production only) ---
  if (!isEmulatorMode) {
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
  }

  // --- GOOGLE_APPLICATION_CREDENTIALS (production only) ---
  if (!isEmulatorMode) {
    const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (typeof credPath !== 'string' || credPath.length === 0) {
      errors.push(
        'GOOGLE_APPLICATION_CREDENTIALS is not set. '
        + 'Point it to your Firebase service account JSON file (e.g. /run/secrets/firebase-sa.json).',
      );
    } else if (!existsSync(credPath)) {
      errors.push(
        `GOOGLE_APPLICATION_CREDENTIALS points to "${credPath}" but the file does not exist.`,
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

export async function register(): Promise<void> {
  // Only validate on the server runtime (not edge, not build-time).
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // import() + webpackIgnore keeps node:fs out of webpack's dependency graph.
    // webpackIgnore works on import() in webpack 5; it does NOT work on require().
    const { existsSync } = await import(/* webpackIgnore: true */ 'node:fs');
    validateEnv(existsSync);
  }
}
