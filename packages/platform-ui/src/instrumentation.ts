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

  // --- STORAGE_BACKEND (ADR-0001) ---
  if (process.env.STORAGE_BACKEND === 'postgres') {
    const dbUrl = process.env.DATABASE_URL;
    if (typeof dbUrl !== 'string' || dbUrl.length === 0) {
      errors.push(
        'STORAGE_BACKEND=postgres requires DATABASE_URL. '
        + 'Set DATABASE_URL or unset STORAGE_BACKEND to fall back to Firestore.',
      );
    }
  }

  // --- MAILGUN EMAIL CONFIG ---
  if (process.env.MEDIFORCE_DISABLE_EMAIL !== 'true') {
    const mailgunVars = ['MAILGUN_API_KEY', 'MAILGUN_DOMAIN', 'MAILGUN_FROM_EMAIL'] as const;
    const missingMailgun = mailgunVars.filter(
      (v) => typeof process.env[v] !== 'string' || process.env[v] === '',
    );
    if (missingMailgun.length > 0) {
      errors.push(
        `Email is enabled but Mailgun config incomplete (missing: ${missingMailgun.join(', ')}). `
        + 'Set the env vars or set MEDIFORCE_DISABLE_EMAIL=true to start without email.',
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

    // ADR-0001 — auto-apply pending Postgres migrations at boot. Idempotent
    // (drizzle's `drizzle.__drizzle_migrations` ledger), safe to run on every
    // start while production is single-container per docker-compose.prod.yml.
    // A multi-replica deployment will gate this behind a Postgres advisory
    // lock in a follow-up ADR.
    //
    // The actual migration runner lives in `instrumentation-postgres.ts`
    // next to this file. Pulling it in via dynamic import keeps the
    // `postgres` and `drizzle-orm` modules off the bundle when the
    // Postgres backend is disabled (the default until cutover). It also
    // walls off Turbopack's instrumentation-pipeline quirks — that file
    // uses absolute paths to the migrations folder and never crosses
    // into `@mediforce/platform-infra`'s broader source tree.
    if (process.env.STORAGE_BACKEND === 'postgres') {
      try {
        // Turbopack's instrumentation resolver rejects `.js` extensions on
        // relative imports here but TS rejects `.ts` extensions without
        // `allowImportingTsExtensions` (incompatible with `tsc -b` /
        // `noEmit` at the workspace root). Pin the `.ts` extension and
        // silence TS — the sibling module is still part of platform-ui's
        // normal compilation so its own types are checked.
        // @ts-expect-error TS5097: literal `.ts` extension intentional.
        const { runBootMigrations } = await import('./instrumentation-postgres.ts');
        await runBootMigrations();
      } catch (err) {
        const divider = '─'.repeat(60);
        console.error(
          `\n${divider}\n  FATAL: Postgres migrations failed at boot\n${divider}\n`,
          err,
          `\n${divider}\n  The server cannot start. Fix the database and restart.\n${divider}\n`,
        );
        process.exit(1);
      }
    }
  }
}
