import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

// Load .env.local so PLATFORM_API_KEY is available inside test processes
// (Next.js reads it for the server, but Playwright's Node runner doesn't).
try { process.loadEnvFile('.env.local'); } catch { /* file may not exist in CI */ }

const useEmulators = process.env.NEXT_PUBLIC_USE_EMULATORS === 'true';
const recording = process.env.E2E_RECORD === 'true';

// When using emulators, run on a separate port so we don't reuse a dev server
// that connects to production Firebase. This is the #1 cause of "data not found"
// failures: seed data goes into the emulator but the reused dev server reads
// from production.
const testPort = useEmulators ? 9007 : 9003;

const projects: PlaywrightTestConfig['projects'] = [];

if (useEmulators) {
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

if (useEmulators) {
  projects.push({
    name: 'authenticated',
    testDir: './e2e/journeys',
    testMatch: '*.journey.ts',
    dependencies: ['setup'],
    use: {
      ...devices['Desktop Chrome'],
      storageState: 'e2e/.auth/user.json',
      ...(recording ? {
        channel: 'chromium',
        video: { mode: 'on', size: { width: 1280, height: 720 } },
        launchOptions: { slowMo: 500 },
      } : {}),
    },
  });
}

export default defineConfig({
  testDir: './e2e',
  timeout: recording ? 120_000 : 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html'], ['json', { outputFile: 'test-results/results.json' }]],
  // The mock OAuth server (Step 5) starts in globalSetup and stops in
  // globalTeardown. Its URL is written to e2e/.mock-oauth-url so both
  // auth-setup (fixture seeding) and journey code can read it.
  globalSetup: useEmulators ? './e2e/global-setup.ts' : undefined,
  globalTeardown: useEmulators ? './e2e/global-teardown.ts' : undefined,
  use: {
    baseURL: `http://localhost:${testPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    // `MOCK_AGENT=true` wires the runtime through MockClaudeCodeAgentPlugin — real
    // Docker still spawns, but the container runs a mock bash command instead of
    // calling Claude. `MEDIFORCE_DATA_DIR` isolates workspace state to a test dir.
    // `NEXT_PUBLIC_APP_URL` is explicit so `getAppBaseUrl` doesn't fall back to the
    // :3000 default before Next sets PORT — the auto-runner fire-and-forget to
    // `/api/processes/:id/run` needs the right host:port.
    command: useEmulators
      ? `NEXT_PUBLIC_USE_EMULATORS=true NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mediforce MOCK_AGENT=true MEDIFORCE_DATA_DIR=/tmp/mediforce-e2e-data NEXT_PUBLIC_APP_URL=http://localhost:${testPort} NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1 npx next dev --webpack -p ${testPort}`
      : 'pnpm dev',
    port: testPort,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
