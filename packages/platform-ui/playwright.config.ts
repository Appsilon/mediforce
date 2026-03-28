import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';

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
  use: {
    baseURL: `http://localhost:${testPort}`,
    headless: true,
    trace: 'on-first-retry',
  },
  projects,
  webServer: {
    command: useEmulators
      ? `NEXT_PUBLIC_USE_EMULATORS=true NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-mediforce npx next dev --webpack -p ${testPort}`
      : 'pnpm dev',
    port: testPort,
    reuseExistingServer: !useEmulators,
    timeout: 120_000,
  },
});
