import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

// Load .env.local so PLATFORM_API_KEY is available inside test processes
// (Next.js reads it for the server, but Playwright's Node runner doesn't).
try { process.loadEnvFile('.env.local'); } catch { /* file may not exist in CI */ }

// Gate for the full E2E suite (setup + api + ui projects). The `test:e2e` npm
// script still sets `NEXT_PUBLIC_USE_EMULATORS=true` to flip this on; the name
// is historical — auth runs on NextAuth now (ADR-0002 PR2), no Firebase
// emulator is involved.
const runFullSuite = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';

// The full suite runs on a separate port so it never reuses a plain `pnpm dev`
// server (which may point at other data). Its server is seeded by auth-setup.
const testPort = runFullSuite
  ? Number(process.env.E2E_PORT ?? 9007)
  : Number(process.env.PORT ?? 9003);

// Fixed, test-only NextAuth signing secret for the E2E server. Never a real
// deployment secret — the E2E server is plain http on localhost.
const E2E_AUTH_SECRET = 'e2e-test-auth-secret-not-for-production-000000000000000000000000';

const projects: PlaywrightTestConfig['projects'] = [];

if (runFullSuite) {
  projects.push({
    name: 'setup',
    testMatch: 'auth-setup.ts',
  });
}

projects.push({
  name: 'chromium',
  use: { ...devices['Desktop Chrome'] },
  testMatch: 'smoke.spec.ts',
});

if (runFullSuite) {
  // L3 API E2E — real Next + Postgres over HTTP, no browser launched.
  // Tests authenticate via X-Api-Key, or a NextAuth session cookie for the
  // `user`-kind anti-enumeration probes (see helpers/multi-namespace.ts).
  // Future: bump workers via `--workers=4` once per-test data isolation
  // is audited (currently single MEDIFORCE_DATA_DIR shared on the server).
  projects.push({
    name: 'api',
    testDir: './e2e/api',
    testMatch: '*.journey.ts',
    dependencies: ['setup'],
  });

  // L4 UI E2E — real Next + Postgres + Chromium. Sparse, main user
  // journeys only. Mocked agent (MOCK_AGENT=true). See AGENTS.md.
  projects.push({
    name: 'authenticated',
    testDir: './e2e/ui',
    testMatch: '*.journey.ts',
    dependencies: ['setup'],
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'e2e/.auth/user.json',
    },
  });
}

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  // The mock OAuth server (Step 5) starts in globalSetup and stops in
  // globalTeardown. Its URL is written to e2e/.mock-oauth-url so both
  // auth-setup (fixture seeding) and journey code can read it.
  globalSetup: runFullSuite ? './e2e/global-setup.ts' : undefined,
  globalTeardown: runFullSuite ? './e2e/global-teardown.ts' : undefined,
  use: {
    baseURL: `http://localhost:${testPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    // `MOCK_AGENT=true` wires the runtime through MockClaudeCodeAgentPlugin — real
    // Docker still spawns, but the container runs a mock bash command instead of
    // calling Claude. `ALLOW_LOCAL_AGENTS=true` lets inline script-container steps
    // run as local child processes so L3 plugin-dispatch journeys don't need a
    // Docker daemon (the Docker spawn path is covered by agent-runtime L5).
    // `MEDIFORCE_DATA_DIR` isolates workspace state to a test dir.
    // `NEXT_PUBLIC_APP_URL` is explicit so `getAppBaseUrl` doesn't fall back to the
    // :3000 default before Next sets PORT — the auto-runner fire-and-forget to
    // `/api/processes/:id/run` needs the right host:port.
    //
    // Default = prebuilt server (`next start`) for CI parity and speed —
    // `next dev`'s JIT compile-on-request dominated e2e wall-clock. Opt into
    // `next dev` via `E2E_DEV_SERVER=true` for interactive iteration where
    // hot-reload beats suite speed (headed / --ui).
    // CI pre-builds in a separate step; locally, `start:e2e` rebuilds whenever
    // the source no longer matches the built bundle (see "E2E build freshness"
    // in docs/dev-quickref.md). `reuseExistingServer: true` connects to a
    // server the build step already started.
    command: runFullSuite
      ? process.env.E2E_DEV_SERVER === 'true'
        ? `MOCK_AGENT=true ALLOW_LOCAL_AGENTS=true MEDIFORCE_DATA_DIR=/tmp/mediforce-e2e-data NEXT_PUBLIC_APP_URL=http://localhost:${testPort} NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npx next dev -p ${testPort}`
        : `pnpm start:e2e`
      : 'pnpm dev',
    // NextAuth server env for E2E (ADR-0002 PR2): the Credentials provider is
    // on so seeded password users authenticate, and a fixed test signing
    // secret is supplied. DATABASE_URL is passed through when set (auth-setup
    // and the server must share one database); everything else inherits from
    // the parent process env.
    env: {
      ENABLE_PASSWORD_AUTH: 'true',
      AUTH_SECRET: process.env.AUTH_SECRET ?? E2E_AUTH_SECRET,
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
    },
    port: testPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
